import {
  EverhourAuthInvalid,
  EverhourError,
  EverhourRateLimited
} from "@projectproject/shared"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  Everhour,
  type EverhourClientError,
  type EverhourProject,
  type EverhourSection,
  type EverhourShape,
  type EverhourTask,
  type EverhourTimeRecord,
  type EverhourTimer,
  type EverhourUser
} from "../Services/Everhour"

const baseUrl = "https://api.everhour.com"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const textField = (
  value: Record<string, unknown>,
  key: string
): string | null => (typeof value[key] === "string" ? value[key] : null)

const idField = (value: Record<string, unknown>): string => String(value.id)

const mapUser = (value: unknown): EverhourUser => {
  const record = isRecord(value) ? value : {}
  return {
    id: idField(record),
    name: textField(record, "name"),
    email: textField(record, "email")
  }
}

const mapProject = (value: unknown): EverhourProject => {
  const record = isRecord(value) ? value : {}
  return {
    id: idField(record),
    name: textField(record, "name") ?? "",
    type: record.type === "list" ? "list" : "board"
  }
}

const mapSection = (value: unknown): EverhourSection => {
  const record = isRecord(value) ? value : {}
  return {
    id: idField(record),
    name: textField(record, "name") ?? "",
    status: record.status === "archived" ? "archived" : "open"
  }
}

const mapTask = (value: unknown): EverhourTask => {
  const record = isRecord(value) ? value : {}
  const labels = Array.isArray(record.labels)
    ? record.labels.flatMap((label) =>
        typeof label === "string" ? [label] : []
      )
    : []
  return {
    id: idField(record),
    name: textField(record, "name") ?? "",
    section:
      typeof record.section === "string" || typeof record.section === "number"
        ? record.section
        : null,
    labels,
    status: record.status === "closed" ? "closed" : "open"
  }
}

const numberField = (
  value: Record<string, unknown>,
  key: string
): number | null => (typeof value[key] === "number" ? value[key] : null)

const idString = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : null

const mapTimer = (value: unknown): EverhourTimer => {
  const record = isRecord(value) ? value : {}
  const task = isRecord(record.task) ? record.task : null
  const user = isRecord(record.user) ? record.user : null
  return {
    id: textField(record, "id"),
    status: record.status === "active" ? "active" : "stopped",
    taskId: task ? idField(task) : null,
    userId: user ? idString(user.id) : null,
    startedAt: textField(record, "startedAt")
  }
}

const mapTimeRecord = (value: unknown): EverhourTimeRecord => {
  const record = isRecord(value) ? value : {}
  const task = isRecord(record.task) ? record.task : null
  return {
    id: idField(record),
    taskId: task ? idField(task) : null,
    userId: idString(record.user),
    seconds: numberField(record, "time") ?? 0,
    date: textField(record, "date") ?? "",
    comment: textField(record, "comment")
  }
}

const mapTimeRecords = (value: unknown): ReadonlyArray<EverhourTimeRecord> =>
  Array.isArray(value) ? value.map(mapTimeRecord) : []

const errorMessage = (body: unknown) => {
  if (!isRecord(body)) return "Everhour error"
  const message = body.message ?? body.error ?? body.detail
  return typeof message === "string" ? message : "Everhour error"
}

const payloadPreview = (payload: unknown) => {
  const text =
    typeof payload === "string" ? payload : JSON.stringify(payload ?? null)
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

const hasTag = (cause: unknown, tag: string) =>
  isRecord(cause) && cause._tag === tag

const isEverhourClientError = (cause: unknown): cause is EverhourClientError =>
  hasTag(cause, "EverhourAuthInvalid") ||
  hasTag(cause, "EverhourRateLimited") ||
  hasTag(cause, "EverhourError")

const send = <A>(
  apiKey: string,
  method: string,
  path: string,
  body: unknown,
  onOk: (payload: unknown, status: number) => A,
  treatNotFound: boolean
) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": apiKey,
            "X-Accept-Version": "1.2"
          },
          body: body === undefined ? undefined : Response.json(body).body
        }),
      catch: (cause) => new EverhourError({ message: String(cause) })
    })
    const payload =
      response.status === 204
        ? null
        : yield* Effect.promise(() => response.json().catch(() => null))
    if (response.ok || (treatNotFound && response.status === 404)) {
      return onOk(payload, response.status)
    }
    const message = errorMessage(payload)
    const endpoint = `${method} ${baseUrl}${path}`
    yield* Effect.logWarning(
      `Everhour API request failed: ${endpoint} -> ${response.status} ${message}`
    ).pipe(
      Effect.annotateLogs({
        endpoint,
        method,
        path,
        status: response.status,
        message,
        responseBody: payloadPreview(payload)
      })
    )
    if (response.status === 401) return yield* new EverhourAuthInvalid()
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "1")
      return yield* new EverhourRateLimited({
        retryAfterSeconds: Number.isFinite(retryAfter) ? retryAfter : 1
      })
    }
    return yield* new EverhourError({ message })
  }).pipe(
    Effect.catch((cause) =>
      isEverhourClientError(cause)
        ? Effect.fail(cause)
        : Effect.fail(new EverhourError({ message: String(cause) }))
    )
  )

const request = <A>(
  apiKey: string,
  method: string,
  path: string,
  body: unknown,
  map: (value: unknown) => A
) => send(apiKey, method, path, body, (payload) => map(payload), false)

const requestNullable = <A>(
  apiKey: string,
  method: string,
  path: string,
  body: unknown,
  map: (value: unknown) => A
) =>
  send(
    apiKey,
    method,
    path,
    body,
    (payload, status): A | null => (status === 404 ? null : map(payload)),
    true
  )

export const EverhourLive = Layer.succeed(Everhour, {
  getCurrentUser: (apiKey) =>
    request(apiKey, "GET", "/users/me", undefined, mapUser),
  getProject: (apiKey, projectId) =>
    request(
      apiKey,
      "GET",
      `/projects/${encodeURIComponent(projectId)}`,
      undefined,
      mapProject
    ),
  createProject: (apiKey, input) =>
    request(apiKey, "POST", "/projects", input, mapProject),
  updateProject: (apiKey, projectId, input) =>
    request(
      apiKey,
      "PUT",
      `/projects/${encodeURIComponent(projectId)}`,
      { ...input, type: "board" },
      mapProject
    ),
  createSection: (apiKey, projectId, input) =>
    request(
      apiKey,
      "POST",
      `/projects/${encodeURIComponent(projectId)}/sections`,
      input,
      mapSection
    ),
  updateSection: (apiKey, sectionId, input) =>
    request(
      apiKey,
      "PUT",
      `/sections/${encodeURIComponent(sectionId)}`,
      input,
      mapSection
    ),
  getTask: (apiKey, taskId) =>
    request(
      apiKey,
      "GET",
      `/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      mapTask
    ),
  createTask: (apiKey, projectId, payload) =>
    request(
      apiKey,
      "POST",
      `/projects/${encodeURIComponent(projectId)}/tasks`,
      payload,
      mapTask
    ),
  updateTask: (apiKey, taskId, payload) =>
    request(
      apiKey,
      "PUT",
      `/tasks/${encodeURIComponent(taskId)}`,
      payload,
      mapTask
    ),
  startTimer: (apiKey, input) =>
    request(apiKey, "POST", "/timers", input, mapTimer),
  getCurrentTimer: (apiKey) =>
    requestNullable(apiKey, "GET", "/timers/current", undefined, mapTimer).pipe(
      Effect.map((timer) =>
        timer && timer.status === "active" && timer.taskId ? timer : null
      )
    ),
  stopTimer: (apiKey) =>
    requestNullable(apiKey, "DELETE", "/timers/current", undefined, (value) => {
      const record = isRecord(value) ? value : {}
      const task = isRecord(record.task) ? record.task : null
      const user = isRecord(record.user) ? record.user : null
      return {
        taskId: task ? idField(task) : null,
        userId: user ? String(user.id) : null,
        date: textField(record, "userDate")
      }
    }).pipe(
      Effect.flatMap((stopped) => {
        if (!stopped || !stopped.taskId) {
          return Effect.succeed<EverhourTimeRecord | null>(null)
        }
        const taskId = stopped.taskId
        const userId = stopped.userId
        const query = stopped.date
          ? `?from=${encodeURIComponent(stopped.date)}&to=${encodeURIComponent(stopped.date)}`
          : ""
        return request(
          apiKey,
          "GET",
          `/tasks/${encodeURIComponent(taskId)}/time${query}`,
          undefined,
          mapTimeRecords
        ).pipe(
          Effect.map((records) => {
            const matching = records.filter(
              (record) => userId === null || record.userId === userId
            )
            const pool = matching.length > 0 ? matching : records
            if (pool.length === 0) return null
            return pool.reduce((newest, record) =>
              Number(record.id) > Number(newest.id) ? record : newest
            )
          })
        )
      })
    ),
  addTime: (apiKey, input) =>
    request(apiKey, "POST", "/time", input, mapTimeRecord),
  createWebhook: (apiKey, input) =>
    request(
      apiKey,
      "POST",
      "/hooks",
      {
        targetUrl: input.targetUrl,
        events: ["api:time:updated"],
        project: input.project
      },
      (value) => ({ id: idField(isRecord(value) ? value : {}) })
    ),
  deleteWebhook: (apiKey, webhookId) =>
    request(
      apiKey,
      "DELETE",
      `/hooks/${encodeURIComponent(webhookId)}`,
      undefined,
      () => undefined
    )
} satisfies EverhourShape)

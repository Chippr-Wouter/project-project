import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaFileNotFound,
  FigmaRateLimited
} from "@projectproject/shared"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import {
  Figma,
  figmaAuthHeader,
  figmaImageScale,
  type FigmaCallError,
  type FigmaCredential,
  type FigmaFileSummary,
  type FigmaShape
} from "../Services/Figma"

const baseUrl = "https://api.figma.com"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const idString = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : ""

const errorMessage = (payload: unknown): string => {
  if (!isRecord(payload)) return "Figma error"
  const message = payload.message ?? payload.err ?? payload.error
  return typeof message === "string" ? message : "Figma error"
}

const parseRetryAfterSeconds = (response: Response): number => {
  const header = response.headers.get("Retry-After")
  const parsed = header === null ? Number.NaN : Number(header)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60
}

const errorForStatus = (
  response: Response,
  fileKey: string | null,
  message: string
): FigmaCallError => {
  if (response.status === 401 || response.status === 403) {
    return new FigmaAuthInvalid()
  }
  if (response.status === 429) {
    return new FigmaRateLimited({
      retryAfterSeconds: parseRetryAfterSeconds(response)
    })
  }
  if (response.status === 404 && fileKey !== null) {
    return new FigmaFileNotFound({ fileKey })
  }
  return new FigmaError({ reason: message })
}

const send = (
  credential: FigmaCredential,
  method: string,
  path: string,
  body: unknown
) =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...figmaAuthHeader(credential)
          },
          body: body === undefined ? undefined : Response.json(body).body
        }),
      catch: (cause) => new FigmaError({ reason: String(cause) })
    })
    const payload =
      response.status === 204
        ? null
        : yield* Effect.promise(() => response.json().catch(() => null))
    return { response, payload }
  })

const request = <A>(
  credential: FigmaCredential,
  method: string,
  path: string,
  body: unknown,
  fileKey: string | null,
  map: (payload: unknown) => A
): Effect.Effect<A, FigmaCallError> =>
  send(credential, method, path, body).pipe(
    Effect.flatMap(({ response, payload }) =>
      response.ok
        ? Effect.succeed(map(payload))
        : Effect.fail(errorForStatus(response, fileKey, errorMessage(payload)))
    )
  )

const fetchBytes = (url: string): Effect.Effect<Uint8Array, FigmaCallError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`unexpected status ${response.status}`)
      }
      const buffer = await response.arrayBuffer()
      return new Uint8Array(buffer)
    },
    catch: (cause) => new FigmaError({ reason: String(cause) })
  })

const getFile = (
  credential: FigmaCredential,
  fileKey: string
): Effect.Effect<FigmaFileSummary, FigmaCallError> =>
  request(
    credential,
    "GET",
    `/v1/files/${encodeURIComponent(fileKey)}?depth=1`,
    undefined,
    fileKey,
    (payload) => {
      const record = isRecord(payload) ? payload : {}
      const lastModifiedRaw = record.lastModified
      const lastModified =
        typeof lastModifiedRaw === "string"
          ? Option.match(DateTime.make(lastModifiedRaw), {
              onNone: () => null,
              onSome: DateTime.toDate
            })
          : null
      return {
        name: typeof record.name === "string" ? record.name : "",
        lastModified,
        thumbnailUrl:
          typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null
      }
    }
  )

export const FigmaLive = Layer.succeed(Figma, {
  getMe: (credential) =>
    request(credential, "GET", "/v1/me", undefined, null, (payload) => {
      const record = isRecord(payload) ? payload : {}
      return {
        id: idString(record.id),
        handle: typeof record.handle === "string" ? record.handle : null,
        email: typeof record.email === "string" ? record.email : null
      }
    }),

  getFile,

  getNodeName: (credential, fileKey, nodeId) =>
    request(
      credential,
      "GET",
      `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
      undefined,
      fileKey,
      (raw) => raw
    ).pipe(
      Effect.flatMap((payload) => {
        const record = isRecord(payload) ? payload : {}
        const nodes = isRecord(record.nodes) ? record.nodes : {}
        const node = isRecord(nodes[nodeId]) ? nodes[nodeId] : null
        const document =
          node !== null && isRecord(node.document) ? node.document : null
        const name =
          document !== null && typeof document.name === "string"
            ? document.name
            : null
        return name === null
          ? Effect.fail(new FigmaFileNotFound({ fileKey }))
          : Effect.succeed({ name })
      })
    ),

  renderNode: (credential, fileKey, nodeId, scale) =>
    Effect.gen(function* () {
      if (nodeId === null) {
        const file = yield* getFile(credential, fileKey)
        if (file.thumbnailUrl === null) {
          return yield* new FigmaError({ reason: "node_not_renderable" })
        }
        return yield* fetchBytes(file.thumbnailUrl)
      }
      const clampedScale = figmaImageScale(scale)
      const payload = yield* request(
        credential,
        "GET",
        `/v1/images/${encodeURIComponent(fileKey)}?ids=${encodeURIComponent(nodeId)}&format=png&scale=${clampedScale}`,
        undefined,
        fileKey,
        (raw) => raw
      )
      const record = isRecord(payload) ? payload : {}
      const images = isRecord(record.images) ? record.images : {}
      const imageUrl = images[nodeId]
      if (typeof imageUrl !== "string") {
        return yield* new FigmaError({ reason: "node_not_renderable" })
      }
      return yield* fetchBytes(imageUrl)
    }),

  createDevResource: (credential, input) =>
    send(credential, "POST", "/v1/dev_resources", {
      dev_resources: [
        {
          name: input.name,
          url: input.url,
          file_key: input.fileKey,
          node_id: input.nodeId
        }
      ]
    }).pipe(
      Effect.flatMap(({ response, payload }) => {
        if (!response.ok) {
          return Effect.fail(
            errorForStatus(response, null, errorMessage(payload))
          )
        }
        const record = isRecord(payload) ? payload : {}
        const errors = Array.isArray(record.errors) ? record.errors : []
        const firstError = isRecord(errors[0]) ? errors[0] : null
        const errorText =
          firstError !== null && typeof firstError.error === "string"
            ? firstError.error
            : null
        if (errorText !== null) {
          return Effect.logDebug(
            "Figma dev resource create skipped by the API"
          ).pipe(
            Effect.annotateLogs({ reason: errorText }),
            Effect.as(null)
          )
        }
        const linksCreated = Array.isArray(record.links_created)
          ? record.links_created
          : []
        const created = isRecord(linksCreated[0]) ? linksCreated[0] : null
        const id = created === null ? null : created.id
        return Effect.succeed(
          typeof id === "string"
            ? id
            : typeof id === "number"
              ? String(id)
              : null
        )
      })
    ),

  deleteDevResource: (credential, fileKey, devResourceId) =>
    send(
      credential,
      "DELETE",
      `/v1/files/${encodeURIComponent(fileKey)}/dev_resources/${encodeURIComponent(devResourceId)}`,
      undefined
    ).pipe(
      Effect.flatMap(({ response, payload }) =>
        response.ok || response.status === 404
          ? Effect.void
          : Effect.fail(errorForStatus(response, null, errorMessage(payload)))
      )
    )
} satisfies FigmaShape)

import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Db } from "../Services/Db"
import type { EverhourTimeRecord } from "../Services/Everhour"
import { EverhourTimeTracking } from "../Services/EverhourTimeTracking"
import {
  EverhourWebhooks,
  type EverhourWebhooksShape
} from "../Services/EverhourWebhooks"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const idString = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : null

const decodeJson = Schema.decodeUnknownExit(
  Schema.fromJsonString(Schema.Unknown)
)

export const parseTimeRecord = (body: string): EverhourTimeRecord | null => {
  const parsed = decodeJson(body)
  if (Exit.isFailure(parsed)) return null
  const payload = parsed.value
  const candidates: Array<unknown> = []
  if (isRecord(payload)) {
    candidates.push(payload)
    if (isRecord(payload.data)) candidates.push(payload.data)
    if (isRecord(payload.time)) candidates.push(payload.time)
    if (isRecord(payload.timeRecord)) candidates.push(payload.timeRecord)
    if (isRecord(payload.payload)) {
      candidates.push(payload.payload)
      if (isRecord(payload.payload.data)) candidates.push(payload.payload.data)
    }
  }
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const id = idString(candidate.id)
    if (id === null) continue
    const time = typeof candidate.time === "number" ? candidate.time : undefined
    if (time === undefined) continue
    const task = isRecord(candidate.task) ? candidate.task : null
    return {
      id,
      taskId: task ? idString(task.id) : null,
      userId: idString(candidate.user),
      seconds: time,
      date: typeof candidate.date === "string" ? candidate.date : "",
      comment: typeof candidate.comment === "string" ? candidate.comment : null
    }
  }
  return null
}

export const EverhourWebhooksLive = Layer.effect(
  EverhourWebhooks,
  Effect.gen(function* () {
    const db = yield* Db
    const timeTracking = yield* EverhourTimeTracking

    const handle: EverhourWebhooksShape["handle"] = ({ secret, body }) =>
      Effect.gen(function* () {
        const integration = yield* db.query.projectEverhourIntegration
          .findFirst({
            columns: { projectIntegrationLinkId: true },
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.webhookSecret, secret)!
            }
          })
          .pipe(Effect.orDie)
        if (!integration) return
        const record = parseTimeRecord(body)
        if (!record) return
        yield* timeTracking.applyWebhookTimeEvent(
          integration.projectIntegrationLinkId,
          record
        )
      }).pipe(Effect.ignore)

    return { handle } satisfies EverhourWebhooksShape
  })
)

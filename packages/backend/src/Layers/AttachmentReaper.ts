import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { Attachments, REAPER_INTERVAL_MS } from "../Services/Attachments"

export const reapAttachments = Effect.gen(function* () {
  const attachments = yield* Attachments
  const { hashed, deduped } = yield* attachments.dedupeOnce()
  if (hashed > 0 || deduped > 0) {
    yield* Effect.logInfo("attachment dedupe complete", { hashed, deduped })
  }
  const { deleted } = yield* attachments.reapOnce()
  if (deleted > 0) {
    yield* Effect.logInfo("attachment reap complete", { deleted })
  }
}).pipe(
  Effect.catchCause((cause) => Effect.logError("attachment reap failed", cause))
)

export const AttachmentReaperLive = Layer.effectDiscard(
  Effect.forkDetach(
    Effect.repeat(
      reapAttachments,
      Schedule.spaced(Duration.millis(REAPER_INTERVAL_MS))
    )
  )
)

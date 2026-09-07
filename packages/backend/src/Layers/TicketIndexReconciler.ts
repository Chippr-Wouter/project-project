import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { TicketIndex } from "../Services/TicketIndex"

export const reconcileTicketIndexOnBoot = Effect.gen(function* () {
  const ticketIndex = yield* TicketIndex
  const summary = yield* ticketIndex.reconcileAllProjects()
  yield* Effect.logInfo("ticket index reconciliation complete", {
    projects: summary.projects.length,
    reconciled: summary.reconciled
  })
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logError("ticket index reconciliation failed", cause)
  )
)

export const TicketIndexReconcilerLive = Layer.effectDiscard(
  Effect.forkDetach(reconcileTicketIndexOnBoot)
)

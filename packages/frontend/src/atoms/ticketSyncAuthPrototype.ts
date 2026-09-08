import * as Effect from "effect/Effect"
import * as ApiClient from "@/services/ApiClient"
import { runtime } from "@/runtime"
import * as TicketSync from "@/services/TicketSync"
import { ticketSyncPrototypeEnabled } from "./ticketSyncPrototype"

export const authenticateTicketSyncPrototype = Effect.fn(
  "authenticateTicketSyncPrototype"
)(
  function* () {
    const sync = yield* TicketSync.TicketSync
    const token = yield* sync.capture
    const client = yield* ApiClient.ApiClient
    const user = yield* client.auth.me().pipe(
      Effect.catchTags({
        Unauthorized: (error) =>
          Effect.gen(function* () {
            yield* sync.clear(token)
            return yield* error
          })
      })
    )
    const owner = yield* sync.activate(user.id, token)
    return { user, owner }
  },
  Effect.retry({
    times: 2,
    while: (error) => error._tag === "TicketSyncAuthChangedPrototype"
  })
)

export const ticketSyncLifecyclePrototypeAtom = runtime.atom(
  Effect.gen(function* () {
    if (!ticketSyncPrototypeEnabled) return undefined
    const sync = yield* TicketSync.TicketSync
    yield* sync.subscribe(() => {
      const root = document.getElementById("root")
      if (root) root.style.visibility = "hidden"
      window.location.reload()
    })
    return yield* Effect.never
  })
)

export const refreshReplicaAfterMutation = Effect.fn(
  "refreshReplicaAfterMutation"
)(
  function* (orgSlug: string, slug: string) {
    if (
      !ticketSyncPrototypeEnabled ||
      orgSlug !== "measure" ||
      slug !== "ten-thousand"
    )
      return
    const { owner } = yield* authenticateTicketSyncPrototype()
    const sync = yield* TicketSync.TicketSync
    yield* sync.poll(owner, { orgSlug, slug })
  },
  Effect.catch((error) =>
    Effect.logWarning("Ticket replica catch-up failed", { error: error._tag })
  )
)

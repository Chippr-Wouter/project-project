import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"

const oauthApplicationsBaseAtom = runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient
      return yield* client.oauthApplications.list()
    })
  )
  .pipe(Atom.setIdleTTL("2 minutes"))

export const oauthApplicationsAtom = Atom.optimistic(oauthApplicationsBaseAtom)

export const revokeOAuthApplicationAtom = Atom.family((id: string) =>
  Atom.optimisticFn(oauthApplicationsAtom, {
    reducer: (current) => {
      if (!Result.isSuccess(current)) return current
      const next = current.value.filter((a) => a.id !== id)
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (_: void, get) {
        const client = yield* ApiClient
        yield* client.oauthApplications.revoke({ params: { id } })
        get.refresh(oauthApplicationsBaseAtom)
      })
    )
  })
)

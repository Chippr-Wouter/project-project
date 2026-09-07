import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import { meAtom } from "./auth"

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const sep = key.indexOf("/")
  return { orgSlug: key.slice(0, sep), slug: key.slice(sep + 1) }
}

export const everhourProfileBaseAtom = runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient
      return yield* client.everhour.profile()
    })
  )
  .pipe(Atom.setIdleTTL("1 minute"))

export const everhourProfileAtom = Atom.optimistic(everhourProfileBaseAtom)

export const connectEverhourProfileAtom = Atom.optimisticFn(
  everhourProfileAtom,
  {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: { apiKey: string }, get) {
        const client = yield* ApiClient
        const profile = yield* client.everhour.connectProfile({
          payload: input
        })
        get.refresh(everhourProfileBaseAtom)
        get.refresh(meAtom)
        return profile
      })
    )
  }
)

export const disconnectEverhourProfileAtom = Atom.optimisticFn(
  everhourProfileAtom,
  {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              connected: false,
              everhourUserId: null,
              name: null,
              email: null,
              lastVerifiedAt: null,
              lastCheckError: null
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        const profile = yield* client.everhour.disconnectProfile()
        get.refresh(everhourProfileBaseAtom)
        get.refresh(meAtom)
        return profile
      })
    )
  }
)

export const everhourProjectStatusBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.everhour.projectStatus({
          params: { orgSlug, slug }
        })
      })
    )
    .pipe(Atom.setIdleTTL("30 seconds"))
})

export const everhourProjectStatusAtom = Atom.family((key: string) =>
  Atom.optimistic(everhourProjectStatusBaseAtom(key))
)

export const connectEverhourProjectAtom = Atom.family((key: string) =>
  Atom.optimisticFn(everhourProjectStatusAtom(key), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const { orgSlug, slug } = splitProjectKey(key)
        const client = yield* ApiClient
        yield* client.everhour.connectProject({ params: { orgSlug, slug } })
        get.refresh(everhourProjectStatusBaseAtom(key))
      })
    )
  })
)

export const syncEverhourProjectAtom = Atom.family((key: string) =>
  Atom.optimisticFn(everhourProjectStatusAtom(key), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const { orgSlug, slug } = splitProjectKey(key)
        const client = yield* ApiClient
        yield* client.everhour.syncProject({ params: { orgSlug, slug } })
        get.refresh(everhourProjectStatusBaseAtom(key))
      })
    )
  })
)

export const disconnectEverhourProjectAtom = Atom.family((key: string) =>
  Atom.optimisticFn(everhourProjectStatusAtom(key), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const { orgSlug, slug } = splitProjectKey(key)
        const client = yield* ApiClient
        yield* client.everhour.disconnectProject({ params: { orgSlug, slug } })
        get.refresh(everhourProjectStatusBaseAtom(key))
      })
    )
  })
)

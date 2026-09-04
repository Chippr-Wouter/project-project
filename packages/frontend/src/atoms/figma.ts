import { Atom, Result } from "@effect-atom/atom-react"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import type { ConnectFigmaProjectInput } from "@projectproject/shared"

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const sep = key.indexOf("/")
  return { orgSlug: key.slice(0, sep), slug: key.slice(sep + 1) }
}

export const figmaProfileBaseAtom = runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient
      return yield* client.figma.profile()
    })
  )
  .pipe(Atom.setIdleTTL("1 minute"))

export const figmaProfileAtom = Atom.optimistic(figmaProfileBaseAtom)

export const disconnectFigmaProfileAtom = Atom.optimisticFn(
  figmaProfileAtom,
  {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(
            { ...current.value, connected: false },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        const profile = yield* client.figma.disconnectProfile()
        get.refresh(figmaProfileBaseAtom)
        return profile
      })
    )
  }
)

export const figmaProjectStatusBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.figma.projectStatus({
          path: { orgSlug, slug }
        })
      })
    )
    .pipe(Atom.setIdleTTL("30 seconds"))
})

export const figmaProjectStatusAtom = Atom.family((key: string) =>
  Atom.optimistic(figmaProjectStatusBaseAtom(key))
)

export const connectFigmaProjectAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(figmaProjectStatusAtom(key), {
    reducer: (current, _input: ConnectFigmaProjectInput) =>
      Result.isSuccess(current)
        ? Result.success(
            { ...current.value, connected: true },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: ConnectFigmaProjectInput, get) {
        const client = yield* ApiClient
        const status = yield* client.figma.connectProject({
          path: { orgSlug, slug },
          payload: input
        })
        get.refresh(figmaProjectStatusBaseAtom(key))
        return status
      })
    )
  })
})

export const disconnectFigmaProjectAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(figmaProjectStatusAtom(key), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(
            { ...current.value, connected: false },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        const status = yield* client.figma.disconnectProject({
          path: { orgSlug, slug }
        })
        get.refresh(figmaProjectStatusBaseAtom(key))
        return status
      })
    )
  })
})

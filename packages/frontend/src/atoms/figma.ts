import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import {
  TicketId,
  type ConnectFigmaProjectInput,
  type FigmaLinkMetadata
} from "@projectproject/shared"

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const sep = key.indexOf("/")
  return { orgSlug: key.slice(0, sep), slug: key.slice(sep + 1) }
}

const makeTicketId = Schema.decodeUnknownSync(TicketId)

const splitTicketKey = (
  key: string
): { orgSlug: string; slug: string; id: TicketId } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    id: makeTicketId(parts.slice(2).join("/"))
  }
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

export const disconnectFigmaProfileAtom = Atom.optimisticFn(figmaProfileAtom, {
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
})

export const figmaProjectStatusBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.figma.projectStatus({
          params: { orgSlug, slug }
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
          params: { orgSlug, slug },
          payload: input
        })
        get.refresh(figmaProjectStatusBaseAtom(key))
        return status
      })
    )
  })
})

export const figmaTicketLinksNoTicketKey = ""

export const figmaTicketLinksAtom = Atom.family((key: string) => {
  if (key === figmaTicketLinksNoTicketKey) {
    return runtime.atom(Effect.succeed([] as ReadonlyArray<FigmaLinkMetadata>))
  }
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.figma.ticketLinks({
          params: { orgSlug, slug, id }
        })
      })
    )
    .pipe(Atom.setIdleTTL("30 seconds"))
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
          params: { orgSlug, slug }
        })
        get.refresh(figmaProjectStatusBaseAtom(key))
        return status
      })
    )
  })
})

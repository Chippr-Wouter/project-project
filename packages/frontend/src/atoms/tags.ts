import { Atom, Result } from "@effect-atom/atom-react"
import * as Reactivity from "@effect/experimental/Reactivity"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import {
  TagColor,
  type CreateTagInput,
  type Tag,
  type TagName,
  type UpdateTagInput
} from "@projectproject/shared"

export const tagsKey = (orgSlug: string, slug: string) => `${orgSlug}/${slug}`

const makeTagColor = Schema.decodeUnknownSync(TagColor)

const tagsBaseAtom = Atom.family((key: string) => {
  const idx = key.indexOf("/")
  const orgSlug = key.slice(0, idx)
  const slug = key.slice(idx + 1)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.tags.list({ path: { orgSlug, slug } })
      })
    )
    .pipe(Atom.setIdleTTL("2 minutes"))
})

export const tagsAtom = Atom.family((key: string) =>
  Atom.optimistic(tagsBaseAtom(key))
)

export const tagUsageCountsAtom = Atom.family((key: string) => {
  const idx = key.indexOf("/")
  const orgSlug = key.slice(0, idx)
  const slug = key.slice(idx + 1)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.tags.usageCounts({ path: { orgSlug, slug } })
      })
    )
    .pipe(
      Atom.withReactivity([
        `tickets/${orgSlug}/${slug}`,
        `ticket-lists/${orgSlug}/${slug}`
      ]),
      Atom.setIdleTTL("2 minutes")
    )
})

export const createTagAtom = Atom.family((key: string) => {
  const idx = key.indexOf("/")
  const orgSlug = key.slice(0, idx)
  const slug = key.slice(idx + 1)
  return Atom.optimisticFn(tagsAtom(key), {
    reducer: (current, input: CreateTagInput) => {
      if (!Result.isSuccess(current)) return current
      const synthetic: Tag = {
        name: input.name,
        color: input.color ?? makeTagColor("#7c3aed"),
        createdBy: "",
        createdAt: DateTime.toDate(DateTime.unsafeNow())
      }
      return Result.success([...current.value, synthetic], { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: CreateTagInput, get) {
        const client = yield* ApiClient
        const tag = yield* client.tags.create({
          path: { orgSlug, slug },
          payload: input
        })
        get.refresh(tagsBaseAtom(key))
        return tag
      })
    )
  })
})

type RenameInput = {
  oldName: TagName
  nextName?: TagName
  color?: Tag["color"]
}
export const renameTagAtom = Atom.family((key: string) => {
  const idx = key.indexOf("/")
  const orgSlug = key.slice(0, idx)
  const slug = key.slice(idx + 1)
  return Atom.optimisticFn(tagsAtom(key), {
    reducer: (current, input: RenameInput) => {
      if (!Result.isSuccess(current)) return current
      const next = current.value.map((t) =>
        t.name === input.oldName
          ? {
              ...t,
              name: input.nextName ?? t.name,
              color: input.color ?? t.color
            }
          : t
      )
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: RenameInput, get) {
        const client = yield* ApiClient
        const patch: UpdateTagInput = {
          ...(input.nextName ? { name: input.nextName } : {}),
          ...(input.color ? { color: input.color } : {})
        }
        const tag = yield* client.tags.update({
          path: { orgSlug, slug, name: input.oldName },
          payload: patch
        })
        get.refresh(tagsBaseAtom(key))
        if (input.nextName) {
          yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        }
        return tag
      })
    )
  })
})

type DeleteInput = { name: TagName }
export const deleteTagAtom = Atom.family((key: string) => {
  const idx = key.indexOf("/")
  const orgSlug = key.slice(0, idx)
  const slug = key.slice(idx + 1)
  return Atom.optimisticFn(tagsAtom(key), {
    reducer: (current, _input: DeleteInput) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: DeleteInput, get) {
        const client = yield* ApiClient
        yield* client.tags.delete({
          path: { orgSlug, slug, name: input.name }
        })
        get.refresh(tagsBaseAtom(key))
        yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
      })
    )
  })
})

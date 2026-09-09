import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import { compareByOrderKey } from "@/components/sprints/board-utils"
import { projectKey } from "@/atoms/projects"
import {
  deriveStatusSlug,
  pickStatusColor,
  type CreateStatusInput,
  type ProjectStatus,
  type ReorderStatusInput,
  type StatusSlug,
  type UpdateStatusInput
} from "@projectproject/shared"

export { projectKey }

const splitKey = (key: string) => {
  const idx = key.indexOf("/")
  return { orgSlug: key.slice(0, idx), slug: key.slice(idx + 1) }
}

export const projectStatusesBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.statuses.list({ params: { orgSlug, slug } })
      })
    )
    .pipe(Atom.setIdleTTL("5 minutes"))
})

export const projectStatusesAtom = Atom.family((key: string) =>
  Atom.optimistic(projectStatusesBaseAtom(key))
)

export const createStatusAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitKey(key)
  return Atom.optimisticFn(projectStatusesAtom(key), {
    reducer: (current, input: CreateStatusInput) => {
      if (!Result.isSuccess(current)) return current
      const derivedSlug = deriveStatusSlug(input.label)
      if (derivedSlug.length === 0) return current
      if (current.value.some((s) => s.slug === derivedSlug)) return current
      const color =
        input.color ?? pickStatusColor(current.value.map((s) => s.color))
      const synthetic: ProjectStatus = {
        slug: derivedSlug as ProjectStatus["slug"],
        label: input.label,
        icon: (input.icon ?? "Circle") as ProjectStatus["icon"],
        color: color as ProjectStatus["color"],
        orderKey: "zzz" as ProjectStatus["orderKey"],
        createdBy: "",
        createdAt: DateTime.toDate(DateTime.nowUnsafe())
      }
      return Result.success([...current.value, synthetic], { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: CreateStatusInput, get) {
        const client = yield* ApiClient
        const created = yield* client.statuses.create({
          params: { orgSlug, slug },
          payload: input
        })
        get.refresh(projectStatusesBaseAtom(key))
        return created
      })
    )
  })
})

type UpdateInput = {
  statusSlug: string
  patch: UpdateStatusInput
}

export const updateStatusAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitKey(key)
  return Atom.optimisticFn(projectStatusesAtom(key), {
    reducer: (current, input: UpdateInput) => {
      if (!Result.isSuccess(current)) return current
      const next = current.value.map((s) =>
        s.slug === input.statusSlug
          ? {
              ...s,
              label: input.patch.label ?? s.label,
              icon: input.patch.icon ?? s.icon,
              color: input.patch.color ?? s.color
            }
          : s
      )
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: UpdateInput, get) {
        const client = yield* ApiClient
        const updated = yield* client.statuses.update({
          params: {
            orgSlug,
            slug,
            statusSlug: input.statusSlug as StatusSlug
          },
          payload: input.patch
        })
        get.refresh(projectStatusesBaseAtom(key))
        if (input.patch.label) {
          yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        }
        return updated
      })
    )
  })
})

type ReorderInput = {
  statusSlug: string
  orderKey: string
}

export const reorderStatusAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitKey(key)
  return Atom.optimisticFn(projectStatusesAtom(key), {
    reducer: (current, input: ReorderInput) => {
      if (!Result.isSuccess(current)) return current
      const next = current.value
        .map((s) =>
          s.slug === input.statusSlug
            ? { ...s, orderKey: input.orderKey as ProjectStatus["orderKey"] }
            : s
        )
        .toSorted(compareByOrderKey)
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: ReorderInput, get) {
        const client = yield* ApiClient
        const reordered = yield* client.statuses.reorder({
          params: {
            orgSlug,
            slug,
            statusSlug: input.statusSlug as StatusSlug
          },
          payload: {
            orderKey: input.orderKey as ReorderStatusInput["orderKey"]
          }
        })
        get.refresh(projectStatusesBaseAtom(key))
        return reordered
      })
    )
  })
})

type DeleteInput = {
  statusSlug: string
  reassignTo?: StatusSlug
}

export const deleteStatusAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitKey(key)
  return Atom.optimisticFn(projectStatusesAtom(key), {
    reducer: (current, input: DeleteInput) =>
      Result.isSuccess(current)
        ? Result.success(
            current.value.filter((s) => s.slug !== input.statusSlug),
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: DeleteInput, get) {
        const client = yield* ApiClient
        yield* client.statuses.remove({
          params: {
            orgSlug,
            slug,
            statusSlug: input.statusSlug as StatusSlug
          },
          query: input.reassignTo ? { reassignTo: input.reassignTo } : {}
        })
        get.refresh(projectStatusesBaseAtom(key))
        yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
      })
    )
  })
})

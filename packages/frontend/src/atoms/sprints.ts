import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { useAtomSet } from "@effect/atom-react"
import { useCallback } from "react"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Cause from "effect/Cause"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import { ticketsInSprintAtom, ticketsInSprintKey } from "@/atoms/tickets"
import { reconcilePendingTicketStatuses } from "@/lib/pendingTicketStatus"
import {
  reconcilePendingSprintAssignments,
  type PendingSprintAssignment
} from "@/lib/pendingSprintAssignment"
import {
  GroupColor,
  GroupId,
  type CompleteSprintDestination,
  type CreateGroupInput,
  type Group,
  type GroupDetail,
  type TicketId,
  type TicketStatus,
  type UpdateGroupInput,
  type UpdateGroupTicketsOutput,
  type UpdateTicketOrderInput
} from "@projectproject/shared"

export type { CompleteSprintDestination }

export const projectKey = (orgSlug: string, slug: string) =>
  `${orgSlug}/${slug}`

export const sprintKey = (orgSlug: string, slug: string, groupId: GroupId) =>
  `${orgSlug}/${slug}/${groupId}`

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const idx = key.indexOf("/")
  return { orgSlug: key.slice(0, idx), slug: key.slice(idx + 1) }
}

const makeGroupId = Schema.decodeUnknownSync(GroupId)
const makeGroupColor = Schema.decodeUnknownSync(GroupColor)

const splitSprintKey = (
  key: string
): { orgSlug: string; slug: string; groupId: GroupId } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    groupId: makeGroupId(parts.slice(2).join("/"))
  }
}

export const sprintsListBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        const all = yield* client.groups.list({ params: { orgSlug, slug } })
        return all.filter((g) => g.kind === "sprint")
      })
    )
    .pipe(Atom.setIdleTTL("1 minute"))
})

export const sprintsListAtom = Atom.family((key: string) =>
  Atom.optimistic(sprintsListBaseAtom(key))
)

const sprintBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug, groupId } = splitSprintKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.groups.get({
          params: { orgSlug, slug, id: groupId }
        })
      })
    )
    .pipe(Atom.setIdleTTL("2 minutes"))
})

export const sprintAtom = Atom.family((key: string) =>
  Atom.optimistic(sprintBaseAtom(key))
)

type CreateSprintReducerInput = {
  name: string
  startsAt: Date
  endsAt: Date
}

let pendingNonce = 0
const nextPendingId = (): GroupId =>
  makeGroupId(`G-${++pendingNonce + 9_999_000}`)

export const createSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(sprintsListAtom(key), {
    reducer: (current, input: CreateSprintReducerInput) => {
      if (!Result.isSuccess(current)) return current
      const now = DateTime.toDate(DateTime.nowUnsafe())
      const synthetic: Group = {
        id: nextPendingId(),
        name: input.name,
        kind: "sprint",
        tickets: [],
        color: makeGroupColor("#777777"),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        completedAt: null,
        createdBy: "",
        createdAt: now,
        updatedAt: now
      }
      return Result.success([synthetic, ...current.value], { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: CreateSprintReducerInput, get) {
        const client = yield* ApiClient
        const payload: CreateGroupInput = {
          name: input.name,
          kind: "sprint",
          startsAt: input.startsAt,
          endsAt: input.endsAt
        }
        const created = yield* client.groups.create({
          params: { orgSlug, slug },
          payload
        })
        get.refresh(sprintsListBaseAtom(key))
        return created
      })
    )
  })
})

type UpdateSprintReducerInput = {
  groupId: GroupId
  patch: UpdateGroupInput
}

export const updateSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(sprintsListAtom(key), {
    reducer: (current, input: UpdateSprintReducerInput) => {
      if (!Result.isSuccess(current)) return current
      const next = current.value.map((g) => {
        if (g.id !== input.groupId) return g
        return {
          ...g,
          name: input.patch.name ?? g.name,
          color: input.patch.color ?? g.color,
          startsAt:
            input.patch.startsAt !== undefined
              ? input.patch.startsAt
              : g.startsAt,
          endsAt:
            input.patch.endsAt !== undefined ? input.patch.endsAt : g.endsAt,
          completedAt:
            input.patch.completedAt !== undefined
              ? input.patch.completedAt
              : g.completedAt,
          updatedAt: DateTime.toDate(DateTime.nowUnsafe())
        }
      })
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: UpdateSprintReducerInput, get) {
        const client = yield* ApiClient
        const updated = yield* client.groups.update({
          params: { orgSlug, slug, id: input.groupId },
          payload: input.patch
        })
        get.refresh(sprintsListBaseAtom(key))
        get.refresh(sprintBaseAtom(sprintKey(orgSlug, slug, input.groupId)))
        return updated
      })
    )
  })
})

type AddTicketsReducerInput = {
  groupId: GroupId
  ticketIds: ReadonlyArray<TicketId>
}

export const pendingSprintAssignmentAtom = Atom.family((_key: string) =>
  Atom.keepAlive(Atom.make<PendingSprintAssignment>(new Map()))
)

export const writePendingSprintAssignments = (
  current: PendingSprintAssignment,
  entries: ReadonlyArray<readonly [TicketId, GroupId | null]>
): PendingSprintAssignment => {
  if (entries.length === 0) return current
  const next = new Map(current)
  for (const [tid, target] of entries) {
    next.set(tid, target)
  }
  return next
}

const writePending = writePendingSprintAssignments

const dropPending = (
  current: PendingSprintAssignment,
  ticketIds: ReadonlyArray<TicketId>
): PendingSprintAssignment => {
  if (current.size === 0) return current
  let next: Map<TicketId, GroupId | null> | null = null
  for (const tid of ticketIds) {
    if (!current.has(tid)) continue
    if (next === null) next = new Map(current)
    next.delete(tid)
  }
  return next ?? current
}

export const addTicketsToSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(sprintsListAtom(key), {
    reducer: (current, input: AddTicketsReducerInput) => {
      if (!Result.isSuccess(current)) return current
      const incoming = new Set<string>(input.ticketIds)
      const now = DateTime.toDate(DateTime.nowUnsafe())
      const next = current.value.map((g) => {
        if (g.id === input.groupId) {
          const merged = [...g.tickets]
          for (const tid of input.ticketIds) {
            if (!merged.includes(tid)) merged.push(tid)
          }
          return { ...g, tickets: merged, updatedAt: now }
        }
        if (g.completedAt !== null) return g
        const filtered = g.tickets.filter((tid) => !incoming.has(tid))
        if (filtered.length === g.tickets.length) return g
        return { ...g, tickets: filtered, updatedAt: now }
      })
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: AddTicketsReducerInput, get) {
        const pending = pendingSprintAssignmentAtom(key)
        const entries = input.ticketIds.map(
          (tid) => [tid, input.groupId] as const
        )
        get.set(pending, writePending(get(pending), entries))

        const releasePending = Effect.sync(() => {
          get.set(pending, dropPending(get(pending), input.ticketIds))
        })

        return yield* Effect.gen(function* () {
          const client = yield* ApiClient
          const targetKey = sprintKey(orgSlug, slug, input.groupId)
          const list = get(sprintsListAtom(key))
          const currentTickets = Result.isSuccess(list)
            ? (list.value.find((g) => g.id === input.groupId)?.tickets ?? [])
            : []
          const union = [...currentTickets]
          for (const tid of input.ticketIds) {
            if (!union.includes(tid)) union.push(tid)
          }
          const result: UpdateGroupTicketsOutput =
            yield* client.groups.updateTickets({
              params: { orgSlug, slug, id: input.groupId },
              payload: { tickets: union }
            })
          get.refresh(sprintsListBaseAtom(key))
          get.refresh(sprintBaseAtom(targetKey))
          for (const ev of result.evicted) {
            get.refresh(sprintBaseAtom(sprintKey(orgSlug, slug, ev.groupId)))
          }
          yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
          yield* get.result(sprintsListBaseAtom(key), {
            suspendOnWaiting: true
          })
          yield* get.result(
            ticketsInSprintAtom(
              ticketsInSprintKey(orgSlug, slug, input.groupId)
            ),
            { suspendOnWaiting: true }
          )
          const refreshed = get(sprintsListAtom(key))
          if (Result.isSuccess(refreshed)) {
            get.set(
              pending,
              reconcilePendingSprintAssignments(get(pending), refreshed.value)
            )
          }
          return result
        }).pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : releasePending
          ),
          Effect.uninterruptible
        )
      })
    )
  })
})

type RemoveTicketsReducerInput = {
  groupId: GroupId
  ticketIds: ReadonlyArray<TicketId>
}

export const removeTicketsFromSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(sprintsListAtom(key), {
    reducer: (current, input: RemoveTicketsReducerInput) => {
      if (!Result.isSuccess(current)) return current
      const drop = new Set<string>(input.ticketIds)
      const now = DateTime.toDate(DateTime.nowUnsafe())
      const next = current.value.map((g) => {
        if (g.id !== input.groupId) return g
        return {
          ...g,
          tickets: g.tickets.filter((tid) => !drop.has(tid)),
          updatedAt: now
        }
      })
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: RemoveTicketsReducerInput, get) {
        const pending = pendingSprintAssignmentAtom(key)
        const entries = input.ticketIds.map(
          (tid) => [tid, null as GroupId | null] as const
        )
        get.set(pending, writePending(get(pending), entries))

        const releasePending = Effect.sync(() => {
          get.set(pending, dropPending(get(pending), input.ticketIds))
        })

        return yield* Effect.gen(function* () {
          const client = yield* ApiClient
          const list = get(sprintsListAtom(key))
          const currentTickets = Result.isSuccess(list)
            ? (list.value.find((g) => g.id === input.groupId)?.tickets ?? [])
            : []
          const drop = new Set<string>(input.ticketIds)
          const remaining = currentTickets.filter((tid) => !drop.has(tid))
          const result = yield* client.groups.updateTickets({
            params: { orgSlug, slug, id: input.groupId },
            payload: { tickets: remaining }
          })
          get.refresh(sprintsListBaseAtom(key))
          get.refresh(sprintBaseAtom(sprintKey(orgSlug, slug, input.groupId)))
          yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
          yield* get.result(sprintsListBaseAtom(key), {
            suspendOnWaiting: true
          })
          yield* get.result(
            ticketsInSprintAtom(
              ticketsInSprintKey(orgSlug, slug, input.groupId)
            ),
            { suspendOnWaiting: true }
          )
          const refreshed = get(sprintsListAtom(key))
          if (Result.isSuccess(refreshed)) {
            get.set(
              pending,
              reconcilePendingSprintAssignments(get(pending), refreshed.value)
            )
          }
          return result
        }).pipe(
          Effect.tapCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.void : releasePending
          ),
          Effect.uninterruptible
        )
      })
    )
  })
})

export function useAddTicketsToSprint(key: string) {
  const addToSprintRaw = useAtomSet(addTicketsToSprintAtom(key))
  const setPending = useAtomSet(pendingSprintAssignmentAtom(key))
  return useCallback(
    (input: AddTicketsReducerInput) => {
      setPending((current) =>
        writePendingSprintAssignments(
          current,
          input.ticketIds.map((tid) => [tid, input.groupId] as const)
        )
      )
      addToSprintRaw(input)
    },
    [addToSprintRaw, setPending]
  )
}

export function useRemoveTicketsFromSprint(key: string) {
  const removeRaw = useAtomSet(removeTicketsFromSprintAtom(key))
  const setPending = useAtomSet(pendingSprintAssignmentAtom(key))
  return useCallback(
    (input: RemoveTicketsReducerInput) => {
      setPending((current) =>
        writePendingSprintAssignments(
          current,
          input.ticketIds.map((tid) => [tid, null as GroupId | null] as const)
        )
      )
      removeRaw(input)
    },
    [removeRaw, setPending]
  )
}

type CompleteSprintReducerInput = {
  groupId: GroupId
  destination: CompleteSprintDestination
  ticketStatuses: ReadonlyMap<
    TicketId,
    GroupDetail["tickets"][number] extends infer _ ? string : never
  >
}

export function splitCarryover(
  ticketIds: ReadonlyArray<TicketId>,
  statuses: ReadonlyMap<string, string>
): { stay: ReadonlyArray<TicketId>; carry: ReadonlyArray<TicketId> } {
  const stay: Array<TicketId> = []
  const carry: Array<TicketId> = []
  for (const tid of ticketIds) {
    const status = statuses.get(tid)
    if (status === "done") stay.push(tid)
    else carry.push(tid)
  }
  return { stay, carry }
}

export const completeSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(sprintsListAtom(key), {
    reducer: (current, input: CompleteSprintReducerInput) => {
      if (!Result.isSuccess(current)) return current
      const now = DateTime.toDate(DateTime.nowUnsafe())
      const source = current.value.find((g) => g.id === input.groupId)
      if (!source) return current
      const { stay, carry } = splitCarryover(
        source.tickets,
        new Map([...input.ticketStatuses].map(([k, v]) => [k as string, v]))
      )
      const dest = input.destination
      const next = current.value.map((g) => {
        if (g.id === input.groupId) {
          return { ...g, tickets: stay, completedAt: now, updatedAt: now }
        }
        if (dest.kind === "sprint" && g.id === dest.groupId) {
          const merged = [...g.tickets]
          for (const tid of carry) {
            if (!merged.includes(tid)) merged.push(tid)
          }
          return { ...g, tickets: merged, updatedAt: now }
        }
        return g
      })
      return Result.success(next, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: CompleteSprintReducerInput, get) {
        const client = yield* ApiClient
        const completed = yield* client.groups.complete({
          params: { orgSlug, slug, id: input.groupId },
          payload: { destination: input.destination }
        })

        get.refresh(sprintsListBaseAtom(key))
        get.refresh(sprintBaseAtom(sprintKey(orgSlug, slug, input.groupId)))
        if (input.destination.kind === "sprint") {
          get.refresh(
            sprintBaseAtom(sprintKey(orgSlug, slug, input.destination.groupId))
          )
        }
        yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        return completed
      })
    )
  })
})

export const deleteSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(sprintsListAtom(key), {
    reducer: (current, input: { groupId: GroupId }) => {
      if (!Result.isSuccess(current)) return current
      return Result.success(
        current.value.filter((g) => g.id !== input.groupId),
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (input: { groupId: GroupId }, get) {
        const client = yield* ApiClient
        yield* client.groups.delete({
          params: { orgSlug, slug, id: input.groupId }
        })
        get.refresh(sprintsListBaseAtom(key))
        return undefined
      })
    )
  })
})

export const pendingTicketStatusAtom = Atom.family((_sprintKey: string) =>
  Atom.make<ReadonlyMap<TicketId, TicketStatus>>(new Map())
)

export const placeTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, groupId } = splitSprintKey(key)
  const project = projectKey(orgSlug, slug)
  return Atom.optimisticFn(sprintsListAtom(project), {
    reducer: (current, input: UpdateTicketOrderInput) => {
      if (!Result.isSuccess(current)) return current
      const sprints = current.value
      const sprintIdx = sprints.findIndex((s) => s.id === groupId)
      if (sprintIdx === -1) return current
      const sprint = sprints[sprintIdx]
      const filtered = sprint.tickets.filter((tid) => tid !== input.ticketId)
      if (input.after !== null && !filtered.includes(input.after)) {
        return current
      }
      const insertAt =
        input.after === null ? 0 : filtered.indexOf(input.after) + 1
      const nextTickets: ReadonlyArray<TicketId> = [
        ...filtered.slice(0, insertAt),
        input.ticketId,
        ...filtered.slice(insertAt)
      ]
      const nextSprints = sprints.slice()
      nextSprints[sprintIdx] = {
        ...sprint,
        tickets: nextTickets,
        updatedAt: DateTime.toDate(DateTime.nowUnsafe())
      }
      return Result.success(nextSprints, { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: UpdateTicketOrderInput, get) {
        const overlay = pendingTicketStatusAtom(key)
        if (input.status !== undefined) {
          const next = new Map(get(overlay))
          next.set(input.ticketId, input.status)
          get.set(overlay, next)
        }
        const sprintTickets = ticketsInSprintAtom(
          ticketsInSprintKey(orgSlug, slug, groupId)
        )
        const resetOverlay = Effect.sync(() => {
          if (input.status === undefined) return
          const next = new Map(get(overlay))
          next.delete(input.ticketId)
          get.set(overlay, next)
        })
        return yield* Effect.gen(function* () {
          const client = yield* ApiClient
          const result = yield* client.groups.updateTicketOrder({
            params: { orgSlug, slug, id: groupId },
            payload: input
          })
          get.refresh(sprintsListBaseAtom(project))
          yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
          yield* get.result(sprintsListBaseAtom(project), {
            suspendOnWaiting: true
          })
          const tickets = yield* get.result(sprintTickets, {
            suspendOnWaiting: true
          })
          if (input.status !== undefined) {
            get.set(
              overlay,
              reconcilePendingTicketStatuses(get(overlay), tickets)
            )
          }
          return result
        }).pipe(
          Effect.catchCause((cause) =>
            resetOverlay.pipe(Effect.andThen(Effect.failCause(cause)))
          )
        )
      })
    )
  })
})

export const sprintMembershipAtom = Atom.family((key: string) =>
  Atom.readable((get) => {
    const result = get(sprintsListAtom(key))
    const pending = get(pendingSprintAssignmentAtom(key))
    const map = new Map<TicketId, Group>()
    if (!Result.isSuccess(result)) {
      return map
    }
    const sprintById = new Map<GroupId, Group>()
    for (const sprint of result.value) {
      sprintById.set(sprint.id, sprint)
      if (sprint.completedAt !== null) continue
      for (const tid of sprint.tickets) {
        if (!map.has(tid)) map.set(tid, sprint)
      }
    }
    for (const [tid, target] of pending) {
      if (target === null) {
        map.delete(tid)
        continue
      }
      const sprint = sprintById.get(target)
      if (sprint && sprint.completedAt === null) map.set(tid, sprint)
    }
    return map
  })
)

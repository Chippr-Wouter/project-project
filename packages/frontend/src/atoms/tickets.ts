import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Data from "effect/Data"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import {
  TicketCountQuery,
  TicketId,
  TicketListQuery,
  ticketListQueryToSearch,
  type QuickCreateTicketInput,
  type Ticket,
  type TicketStatus,
  type UpdateTicketInput
} from "@projectproject/shared"

class MalformedQuery extends Data.TaggedError("MalformedQuery")<{
  readonly cause: unknown
}> {}

const encodeQueryForKey = Schema.encodeSync(TicketListQuery)

export const ticketsListKey = (
  orgSlug: string,
  slug: string,
  query: TicketListQuery
): string => {
  const encoded = encodeQueryForKey(query)
  return `${orgSlug}/${slug}/${JSON.stringify(encoded)}`
}

export const ticketsListKeyForStatus = (
  orgSlug: string,
  slug: string,
  baseQuery: TicketListQuery,
  status: TicketStatus
): string =>
  ticketsListKey(orgSlug, slug, {
    ...baseQuery,
    filter: { ...baseQuery.filter, status: [status] },
    cursor: undefined
  })

interface SplitFamilyKey {
  readonly orgSlug: string
  readonly slug: string
  readonly queryJson: string
}

interface PendingTicketStatusChange {
  readonly ticket: Ticket
  readonly status: TicketStatus
  readonly sourceSectionKey: string
  readonly destSectionKey: string
  readonly countKey: string
}

export const pendingTicketStatusChangesAtom = Atom.family((_key: string) =>
  Atom.make<ReadonlyMap<TicketId, PendingTicketStatusChange>>(new Map())
)

const decodeQueryFromKey = Schema.decodeUnknownSync(TicketListQuery)

const splitFamilyKey = (key: string): SplitFamilyKey => {
  const firstSlash = key.indexOf("/")
  const secondSlash = key.indexOf("/", firstSlash + 1)
  return {
    orgSlug: key.slice(0, firstSlash),
    slug: key.slice(firstSlash + 1, secondSlash),
    queryJson: key.slice(secondSlash + 1)
  }
}

const decodeListQuery = (queryJson: string) =>
  Effect.try({
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    try: () => decodeQueryFromKey(JSON.parse(queryJson) as unknown),
    catch: (cause) => new MalformedQuery({ cause })
  })

const makeTicketId = Schema.decodeUnknownSync(TicketId)

export const splitTicketKey = (
  key: string
): { orgSlug: string; slug: string; id: TicketId } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    id: makeTicketId(parts.slice(2).join("/"))
  }
}

interface TicketsListValue {
  readonly items: ReadonlyArray<Ticket>
  readonly nextCursor: string | null
}

export type { TicketsListValue }

const ticketsListBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug, queryJson } = splitFamilyKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const query = yield* decodeListQuery(queryJson)
        const client = yield* ApiClient
        const page = yield* client.tickets.list({
          params: { orgSlug, slug },
          query: ticketListQueryToSearch(query)
        })
        const value: TicketsListValue = {
          items: page.items,
          nextCursor: page.nextCursor
        }
        return value
      })
    )
    .pipe(
      Atom.withReactivity(["tickets", orgSlug, slug]),
      Atom.setIdleTTL("2 minutes")
    )
})

interface AppendedPagesValue {
  readonly items: ReadonlyArray<Ticket>
  readonly nextCursor: string | null
  readonly baseTimestamp: number | null
}

const ticketsListAppendedAtom = Atom.family((_key: string) =>
  Atom.make<AppendedPagesValue>({
    items: [],
    nextCursor: null,
    baseTimestamp: null
  })
)

const ticketsListMergedAtom = Atom.family((key: string) =>
  Atom.readable((get): Result.AsyncResult<TicketsListValue, unknown> => {
    const base: Result.AsyncResult<TicketsListValue, unknown> = get(
      ticketsListBaseAtom(key)
    )
    const appended = get(ticketsListAppendedAtom(key))
    if (!Result.isSuccess(base)) return base
    const fresh = appended.baseTimestamp === base.timestamp
    if (!fresh || appended.items.length === 0) return base
    const merged: TicketsListValue = {
      items: [...base.value.items, ...appended.items],
      nextCursor: appended.nextCursor
    }
    return Result.success(merged, {
      waiting: base.waiting,
      timestamp: base.timestamp
    })
  })
)

const ticketsListOptimisticAtom = Atom.family((key: string) =>
  Atom.optimistic(ticketsListMergedAtom(key))
)

export const ticketsListAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitFamilyKey(key)
  return Atom.readable((get): Result.AsyncResult<TicketsListValue, unknown> => {
    const list = get(ticketsListOptimisticAtom(key))
    if (!Result.isSuccess(list)) return list

    const pending = get(pendingTicketStatusChangesAtom(`${orgSlug}/${slug}`))
    let items = list.value.items

    for (const change of pending.values()) {
      if (change.sourceSectionKey === key) {
        items = items.filter((ticket) => ticket.id !== change.ticket.id)
      }
      if (change.destSectionKey === key) {
        items = [
          { ...change.ticket, status: change.status },
          ...items.filter((ticket) => ticket.id !== change.ticket.id)
        ]
      }
    }

    return Result.success(
      { items, nextCursor: list.value.nextCursor },
      {
        waiting: list.waiting,
        timestamp: list.timestamp
      }
    )
  })
})

export const loadMoreTicketsAtom = Atom.family((key: string) => {
  const { orgSlug, slug, queryJson } = splitFamilyKey(key)
  return runtime.fn(
    Effect.fn(function* (_: void, get) {
      const base: Result.AsyncResult<TicketsListValue, unknown> = get(
        ticketsListBaseAtom(key)
      )
      if (!Result.isSuccess(base)) return
      const appended = get(ticketsListAppendedAtom(key))
      const fresh = appended.baseTimestamp === base.timestamp
      const cursor =
        fresh && appended.items.length > 0
          ? appended.nextCursor
          : base.value.nextCursor
      if (cursor === null) return
      const query = yield* decodeListQuery(queryJson)
      const client = yield* ApiClient
      const next = yield* client.tickets.list({
        params: { orgSlug, slug },
        query: ticketListQueryToSearch({ ...query, cursor })
      })
      get.set(ticketsListAppendedAtom(key), {
        items: fresh ? [...appended.items, ...next.items] : next.items,
        nextCursor: next.nextCursor,
        baseTimestamp: base.timestamp
      })
    })
  )
})

const encodeCountQueryForKey = Schema.encodeSync(TicketCountQuery)

export const ticketsCountKey = (
  orgSlug: string,
  slug: string,
  query: TicketCountQuery
): string => {
  const encoded = encodeCountQueryForKey(query)
  return `${orgSlug}/${slug}/${JSON.stringify(encoded)}`
}

const decodeCountQueryFromKey = Schema.decodeUnknownSync(TicketCountQuery)

const decodeCountQuery = (queryJson: string) =>
  Effect.try({
    // @effect-diagnostics-next-line preferSchemaOverJson:off
    try: () => decodeCountQueryFromKey(JSON.parse(queryJson) as unknown),
    catch: (cause) => new MalformedQuery({ cause })
  })

const ticketsCountBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug, queryJson } = splitFamilyKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const query = yield* decodeCountQuery(queryJson)
        const client = yield* ApiClient
        return yield* client.tickets.count({
          params: { orgSlug, slug },
          query: ticketListQueryToSearch(query)
        })
      })
    )
    .pipe(
      Atom.withReactivity(["tickets", orgSlug, slug]),
      Atom.setIdleTTL("2 minutes")
    )
})

const ticketsCountOptimisticAtom = Atom.family((key: string) =>
  Atom.optimistic(ticketsCountBaseAtom(key))
)

export const ticketsCountAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitFamilyKey(key)
  return Atom.readable((get) => {
    const counts = get(ticketsCountOptimisticAtom(key))
    if (!Result.isSuccess(counts)) return counts

    const pending = get(pendingTicketStatusChangesAtom(`${orgSlug}/${slug}`))
    const matching = [...pending.values()].filter(
      (change) => change.countKey === key
    )
    if (matching.length === 0) return counts

    const byStatus = { ...counts.value.byStatus }
    for (const change of matching) {
      byStatus[change.ticket.status] = Math.max(
        0,
        (byStatus[change.ticket.status] ?? 0) - 1
      )
      byStatus[change.status] = (byStatus[change.status] ?? 0) + 1
    }

    return Result.success(
      { total: counts.value.total, byStatus },
      { waiting: true, timestamp: counts.timestamp }
    )
  })
})

export const ticketKey = (orgSlug: string, slug: string, id: TicketId) =>
  `${orgSlug}/${slug}/${id}`

export const ticketBodyDraftAtom = Atom.family((_key: string) =>
  Atom.make<string | null>(null).pipe(Atom.setIdleTTL("10 minutes"))
)

export const ticketBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.tickets.get({ params: { orgSlug, slug, id } })
      })
    )
    .pipe(
      Atom.withReactivity(["tickets", orgSlug, slug]),
      Atom.setIdleTTL("2 minutes")
    )
})

export const ticketAtom = Atom.family((key: string) =>
  Atom.optimistic(ticketBaseAtom(key))
)

export interface QuickCreateTicketArg {
  readonly ticket: QuickCreateTicketInput
  readonly viewerId: string
  readonly projectPrefix: string
}

function optimisticTicketId(
  items: ReadonlyArray<Ticket>,
  prefix: string
): TicketId {
  const taken = new Set<string>(items.map((t) => t.id))
  let n = 999999
  while (taken.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}` as TicketId
}

export const quickCreateTicketAtom = Atom.family((sectionKey: string) => {
  const { orgSlug, slug } = splitFamilyKey(sectionKey)
  return Atom.optimisticFn(ticketsListOptimisticAtom(sectionKey), {
    reducer: (current, input: QuickCreateTicketArg) => {
      if (!Result.isSuccess(current)) return current
      const status = input.ticket.status ?? ("todo" as TicketStatus)
      const now = DateTime.toDate(DateTime.nowUnsafe())
      const predicted: Ticket = {
        id: optimisticTicketId(current.value.items, input.projectPrefix),
        title: input.ticket.title,
        status,
        type: input.ticket.type ?? "other",
        priority: "med",
        tags: [],
        branch: null,
        pr: null,
        prState: null,
        lastTransitionedPr: null,
        gitState: { tag: "no_branch", baseBranch: "" },
        assignees: [],
        archivedAt: null,
        createdBy: input.viewerId,
        createdAt: now,
        updatedAt: now
      }
      return Result.success(
        {
          items: [predicted, ...current.value.items],
          nextCursor: current.value.nextCursor
        },
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (input: QuickCreateTicketArg, get) {
        const client = yield* ApiClient
        const created = yield* client.tickets.quickCreate({
          params: { orgSlug, slug },
          payload: input.ticket
        })
        get.refresh(ticketsListBaseAtom(sectionKey))
        yield* Reactivity.invalidate(["tickets", orgSlug, slug])
        return created
      })
    )
  })
})

export const ticketsInSprintKey = (
  orgSlug: string,
  slug: string,
  groupId: string
) => `${orgSlug}/${slug}/${groupId}`

const splitSprintKey = (
  key: string
): { orgSlug: string; slug: string; groupId: string } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    groupId: parts.slice(2).join("/")
  }
}

export const ticketsInSprintAtom = Atom.family((key: string) => {
  const { orgSlug, slug, groupId } = splitSprintKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.groups.listTickets({
          params: { orgSlug, slug, id: groupId as never }
        })
      })
    )
    .pipe(
      Atom.withReactivity(["tickets", orgSlug, slug]),
      Atom.setIdleTTL("2 minutes")
    )
})

export interface TicketSearchOptions {
  readonly q?: string
  readonly excludeGroupId?: string
  readonly limit?: number
}

export const ticketSearchKey = (
  orgSlug: string,
  slug: string,
  options: TicketSearchOptions
) =>
  `${orgSlug}/${slug}/${JSON.stringify({
    q: options.q ?? "",
    excludeGroupId: options.excludeGroupId ?? "",
    limit: options.limit ?? 0
  })}`

const splitSearchKey = (
  key: string
): { orgSlug: string; slug: string; options: TicketSearchOptions } => {
  const firstSlash = key.indexOf("/")
  const secondSlash = key.indexOf("/", firstSlash + 1)
  const orgSlug = key.slice(0, firstSlash)
  const slug = key.slice(firstSlash + 1, secondSlash)
  const optionsJson = key.slice(secondSlash + 1)
  const parsed = JSON.parse(optionsJson) as {
    q: string
    excludeGroupId: string
    limit: number
  }
  return {
    orgSlug,
    slug,
    options: {
      q: parsed.q.length > 0 ? parsed.q : undefined,
      excludeGroupId:
        parsed.excludeGroupId.length > 0 ? parsed.excludeGroupId : undefined,
      limit: parsed.limit > 0 ? parsed.limit : undefined
    }
  }
}

export const ticketSearchAtom = Atom.family((key: string) => {
  const { orgSlug, slug, options } = splitSearchKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.tickets.search({
          params: { orgSlug, slug },
          query: {
            ...(options.q ? { q: options.q } : {}),
            ...(options.excludeGroupId
              ? { excludeGroupId: options.excludeGroupId }
              : {}),
            ...(options.limit ? { limit: String(options.limit) } : {})
          }
        })
      })
    )
    .pipe(
      Atom.withReactivity(["tickets", orgSlug, slug]),
      Atom.setIdleTTL("2 minutes")
    )
})

export const updateTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime.fn(
    Effect.fn(function* (input: UpdateTicketInput, get) {
      const client = yield* ApiClient
      const updated = yield* client.tickets.update({
        params: { orgSlug, slug, id },
        payload: input
      })
      get.refresh(ticketBaseAtom(ticketKey(orgSlug, slug, id)))
      yield* Reactivity.invalidate(["tickets", orgSlug, slug])
      return updated
    })
  )
})

export const archiveTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return Atom.optimisticFn(ticketAtom(key), {
    reducer: (current, _input: { reason?: string }) =>
      Result.isSuccess(current)
        ? Result.success(
            current.value.archivedAt === null
              ? {
                  ...current.value,
                  archivedAt: DateTime.toDate(DateTime.nowUnsafe())
                }
              : current.value,
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: { reason?: string }, get) {
        const client = yield* ApiClient
        const updated = yield* client.tickets.archive({
          params: { orgSlug, slug, id },
          payload: { reason: input.reason }
        })
        get.refresh(ticketBaseAtom(ticketKey(orgSlug, slug, id)))
        yield* Reactivity.invalidate(["tickets", orgSlug, slug])
        return updated
      })
    )
  })
})

export const unarchiveTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return Atom.optimisticFn(ticketAtom(key), {
    reducer: (current, _input: void) =>
      Result.isSuccess(current)
        ? Result.success(
            { ...current.value, archivedAt: null },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        const updated = yield* client.tickets.unarchive({
          params: { orgSlug, slug, id }
        })
        get.refresh(ticketBaseAtom(ticketKey(orgSlug, slug, id)))
        yield* Reactivity.invalidate(["tickets", orgSlug, slug])
        return updated
      })
    )
  })
})

export const deleteTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const client = yield* ApiClient
      yield* client.tickets.delete({ params: { orgSlug, slug, id } })
      get.refresh(ticketBaseAtom(ticketKey(orgSlug, slug, id)))
      yield* Reactivity.invalidate(["tickets", orgSlug, slug])
    })
  )
})

export interface UpdateTicketStatusArg {
  readonly ticket: Ticket
  readonly status: TicketStatus
  readonly destSectionKey: string
  readonly sourceSectionKey: string
  readonly countKey: string
}

export const updateTicketStatusAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  const project = `${orgSlug}/${slug}`
  return Atom.optimisticFn(ticketAtom(key), {
    reducer: (current, input: UpdateTicketStatusArg) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              ...current.value,
              status: input.status,
              updatedAt: DateTime.toDate(DateTime.nowUnsafe())
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: UpdateTicketStatusArg, get) {
        const pending = pendingTicketStatusChangesAtom(project)
        const next = new Map(get(pending))
        next.set(id, input)
        get.set(pending, next)

        const clearPending = Effect.sync(() => {
          const current = get(pending)
          if (current.get(id) !== input) return
          const settled = new Map(current)
          settled.delete(id)
          get.set(pending, settled)
        })

        return yield* Effect.gen(function* () {
          const client = yield* ApiClient
          const updated = yield* client.tickets.update({
            params: { orgSlug, slug, id },
            payload: { status: input.status }
          })
          const detail = ticketBaseAtom(key)
          const source = ticketsListBaseAtom(input.sourceSectionKey)
          const destination = ticketsListBaseAtom(input.destSectionKey)
          const counts = ticketsCountBaseAtom(input.countKey)
          get.refresh(detail)
          get.refresh(source)
          get.refresh(destination)
          yield* get
            .result(detail, { suspendOnWaiting: true })
            .pipe(Effect.ignore)
          yield* get
            .result(source, { suspendOnWaiting: true })
            .pipe(Effect.ignore)
          yield* get
            .result(destination, { suspendOnWaiting: true })
            .pipe(Effect.ignore)
          get.refresh(counts)
          yield* get
            .result(counts, { suspendOnWaiting: true })
            .pipe(Effect.ignore)
          yield* clearPending
          yield* Reactivity.invalidate(["tickets", orgSlug, slug])
          return updated
        }).pipe(Effect.ensuring(clearPending))
      })
    )
  })
})

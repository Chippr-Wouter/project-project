import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { ticketsCountAtom, ticketsCountKey } from "@/atoms/tickets"
import { boardStatusesFor } from "@/components/sprints/board-utils"
import {
  ticketListQueryToSearch,
  type GroupId,
  type Member,
  type ProjectStatus,
  type TicketCountQuery,
  type TicketFilter,
  type TicketListQuery
} from "@projectproject/shared"
import { TICKET_SEARCH_KEYS } from "../url"

export type SprintFilterValue = "all" | "unassigned" | GroupId
export type FilterDimension =
  | "type"
  | "assignee"
  | "tags"
  | "sprint"
  | "archived"
type SearchValue = string | ReadonlyArray<string> | undefined
type SearchRecord = { readonly [k: string]: SearchValue }
const EMPTY_STATUSES: ReadonlyArray<ProjectStatus> = []

type ToolbarProps = {
  orgSlug: string
  slug: string
  query: TicketListQuery
  members: ReadonlyArray<Member>
  counts: Record<string, number>
  filters: ReadonlyArray<FilterDimension>
}
type ToolbarContextValue = ToolbarProps & {
  updateQuery: (query: TicketListQuery) => void
  patchFilter: (patch: Partial<TicketFilter>) => void
  clearAll: () => void
  searchRevision: number
}
const ToolbarContext = createContext<ToolbarContextValue | null>(null)
export function useToolbar() {
  const value = use(ToolbarContext)
  if (!value)
    throw new Error("Toolbar parts must render inside Toolbar.Provider")
  return value
}

export function activeFilterCount(
  query: TicketListQuery,
  dimensions: ReadonlyArray<FilterDimension>
) {
  return dimensions.filter((dimension) => {
    const value = query.filter?.[dimension === "sprint" ? "groupId" : dimension]
    return Array.isArray(value) ? value.length > 0 : value === true
  }).length
}

const pruneFilter = (f: TicketFilter | undefined): TicketFilter | undefined => {
  if (!f) return undefined
  const hasAny =
    (f.status && f.status.length > 0) ||
    (f.type && f.type.length > 0) ||
    (f.assignee && f.assignee.length > 0) ||
    (f.tags && f.tags.length > 0) ||
    (f.groupId && f.groupId.length > 0) ||
    f.hasBranch !== undefined ||
    f.hasPr !== undefined ||
    f.updatedAfter !== undefined ||
    f.archived !== undefined
  return hasAny ? f : undefined
}

export function useServerTicketCounts(
  orgSlug: string,
  slug: string,
  query: TicketListQuery
): Record<string, number> {
  const countQuery: TicketCountQuery = { filter: query.filter, q: query.q }
  const countsResult = useAtomValue(
    ticketsCountAtom(ticketsCountKey(orgSlug, slug, countQuery))
  )
  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const statuses: ReadonlyArray<ProjectStatus> = Result.isSuccess(
    statusesResult
  )
    ? statusesResult.value
    : EMPTY_STATUSES
  return useMemo<Record<string, number>>(() => {
    if (!Result.isSuccess(countsResult)) return { all: 0 }
    const byStatus = countsResult.value.byStatus as Record<string, number>
    const next: Record<string, number> = { all: countsResult.value.total }
    for (const s of boardStatusesFor(statuses)) {
      next[s] = byStatus[s] ?? 0
    }
    return next
  }, [countsResult, statuses])
}

export function ToolbarProvider({
  children,
  ...props
}: ToolbarProps & { children: ReactNode }) {
  const { query } = props
  const router = useRouter()
  const navigate = useNavigate()
  const [searchRevision, setSearchRevision] = useState(0)
  const latestQueryRef = useRef(query)
  useEffect(() => {
    latestQueryRef.current = query
  }, [query])

  const updateQuery = useCallback(
    (next: TicketListQuery) => {
      const nextSearch = ticketListQueryToSearch({ ...next, cursor: undefined })
      void navigate({
        to: router.state.location.pathname,
        search: (prev: SearchRecord): SearchRecord => {
          const cleared: { [k: string]: SearchValue } = { ...prev }
          for (const k of TICKET_SEARCH_KEYS) cleared[k] = undefined
          return { ...cleared, ...nextSearch }
        },
        replace: true,
        resetScroll: false
      })
    },
    [navigate, router]
  )

  const patchFilter = useCallback(
    (patch: Partial<TicketFilter>) => {
      const current = latestQueryRef.current
      updateQuery({
        ...current,
        filter: pruneFilter({ ...current.filter, ...patch })
      })
    },
    [updateQuery]
  )

  const clearAll = () => {
    setSearchRevision((revision) => revision + 1)
    updateQuery({ sort: latestQueryRef.current.sort })
  }
  return (
    <ToolbarContext
      value={{ ...props, updateQuery, patchFilter, clearAll, searchRevision }}
    >
      {children}
    </ToolbarContext>
  )
}

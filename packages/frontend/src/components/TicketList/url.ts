import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  ticketListQueryToSearch,
  type TicketListQuery
} from "@projectproject/shared"

export function queryHasActiveFilter(q: TicketListQuery): boolean {
  if (q.q !== undefined && q.q.length > 0) return true
  const f = q.filter
  if (!f) return false
  return (
    (f.status?.length ?? 0) > 0 ||
    (f.type?.length ?? 0) > 0 ||
    (f.assignee?.length ?? 0) > 0 ||
    (f.tags?.length ?? 0) > 0 ||
    (f.groupId?.length ?? 0) > 0 ||
    f.hasBranch !== undefined ||
    f.hasPr !== undefined ||
    f.updatedAfter !== undefined ||
    f.archived !== undefined
  )
}

export const TICKET_SEARCH_KEYS = [
  "status",
  "type",
  "assignee",
  "tags",
  "groupId",
  "hasBranch",
  "hasPr",
  "archived",
  "sort",
  "q",
  "cursor"
] as const

type SearchValue = string | ReadonlyArray<string> | undefined
type SearchRecord = { readonly [k: string]: SearchValue }

export function useResetTicketSearch() {
  const router = useRouter()
  const navigate = useNavigate()
  return () => {
    void navigate({
      to: router.state.location.pathname,
      search: (prev: SearchRecord): SearchRecord => {
        const cleared: { [k: string]: SearchValue } = { ...prev }
        for (const k of TICKET_SEARCH_KEYS) cleared[k] = undefined
        return cleared
      },
      replace: true
    })
  }
}

export function useUpdateTicketQuery() {
  const router = useRouter()
  const navigate = useNavigate()
  return (query: TicketListQuery) => {
    const nextSearch = ticketListQueryToSearch({ ...query, cursor: undefined })
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
  }
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject
} from "react"
import { meAtom } from "@/atoms/auth"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { ticketsCountAtom, ticketsCountKey } from "@/atoms/tickets"
import { boardStatusesFor } from "@/components/sprints/board-utils"
import {
  NATURAL_SORT_DIR,
  ticketListQueryToSearch,
  type GroupId,
  type Member,
  type ProjectStatus,
  type SortKey,
  type TagName,
  type TicketCountQuery,
  type TicketFilter,
  type TicketListQuery,
  type TicketStatus,
  type TicketType
} from "@projectproject/shared"
import { TICKET_SEARCH_KEYS } from "../url"
import { MIN_SEARCH_CHARS, useTicketSearch } from "../search"

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

const FULL_FITS_ROW = 720
const ALL_COMPACT_FITS_ROW = 460
const COMPACT_FITS_WRAPPED = 360

interface ToolbarState {
  readonly query: TicketListQuery
  readonly status: TicketStatus | "all"
  readonly typeFilter: TicketType | "all"
  readonly assigneeFilter: string
  readonly selectedTags: ReadonlyArray<TagName>
  readonly sprintFilter: SprintFilterValue
  readonly archivedFilter: boolean
  readonly sortKey: SortKey
  readonly searchInput: string
  readonly counts: Record<string, number>
  readonly statuses: ReadonlyArray<ProjectStatus>
  readonly members: ReadonlyArray<Member>
  readonly viewerId: string | null
  readonly measured: boolean
  readonly compact: boolean
  readonly controlsCompact: boolean
  readonly activeFilterCount: number
  readonly hasActiveFilters: boolean
  readonly searchBelowMinChars: boolean
}

interface ToolbarActions {
  readonly setStatus: (s: TicketStatus | "all") => void
  readonly setTypeFilter: (t: TicketType | "all") => void
  readonly setAssigneeFilter: (a: string) => void
  readonly setSelectedTags: (tags: ReadonlyArray<TagName>) => void
  readonly setSprintFilter: (s: SprintFilterValue) => void
  readonly setArchivedFilter: (on: boolean) => void
  readonly setSortKey: (k: SortKey) => void
  readonly setSearchQuery: (q: string) => void
  readonly setSearchFocused: (focused: boolean) => void
  readonly flushSearch: () => void
  readonly clearSearch: () => void
  readonly clearAll: () => void
  readonly declareDimensions: (dimensions: ReadonlySet<FilterDimension>) => void
}

interface ToolbarMeta {
  readonly orgSlug: string
  readonly slug: string
  readonly containerRef: RefObject<HTMLDivElement | null>
  readonly searchRef: RefObject<HTMLInputElement | null>
}

interface ToolbarContextValue {
  readonly state: ToolbarState
  readonly actions: ToolbarActions
  readonly meta: ToolbarMeta
}

const ToolbarContext = createContext<ToolbarContextValue | null>(null)

export function useToolbar(): ToolbarContextValue {
  const ctx = use(ToolbarContext)
  if (!ctx) throw new Error("Toolbar parts must render inside Toolbar.Provider")
  return ctx
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
  orgSlug,
  slug,
  query,
  members,
  counts,
  children
}: {
  orgSlug: string
  slug: string
  query: TicketListQuery
  members: ReadonlyArray<Member>
  counts: Record<string, number>
  children: ReactNode
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const me = useAtomValue(meAtom)
  const viewerId = Result.isSuccess(me) ? me.value.id : null

  const filter = query.filter
  const status: TicketStatus | "all" =
    filter?.status?.length === 1 ? filter.status[0] : "all"
  const typeFilter: TicketType | "all" =
    filter?.type?.length === 1 ? filter.type[0] : "all"
  const assigneeFilter: string =
    filter?.assignee?.length === 1
      ? filter.assignee[0] === null
        ? "unassigned"
        : filter.assignee[0]
      : "all"
  const selectedTags: ReadonlyArray<TagName> = filter?.tags ?? []
  const sprintFilter: SprintFilterValue =
    filter?.groupId?.length === 1
      ? filter.groupId[0] === null
        ? "unassigned"
        : filter.groupId[0]
      : "all"
  const archivedFilter = filter?.archived === true
  const sortKey: SortKey = query.sort.key
  const queryStr = query.q ?? ""

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

  const setStatus = useCallback(
    (s: TicketStatus | "all") =>
      patchFilter({ status: s === "all" ? undefined : [s] }),
    [patchFilter]
  )
  const setTypeFilter = useCallback(
    (t: TicketType | "all") =>
      patchFilter({ type: t === "all" ? undefined : [t] }),
    [patchFilter]
  )
  const setAssigneeFilter = useCallback(
    (a: string) => {
      let assignee: TicketFilter["assignee"]
      if (a === "all") assignee = undefined
      else if (a === "mine") assignee = ["mine"]
      else if (a === "unassigned") assignee = [null]
      else assignee = [a]
      patchFilter({ assignee })
    },
    [patchFilter]
  )
  const setSelectedTags = useCallback(
    (tags: ReadonlyArray<TagName>) =>
      patchFilter({ tags: tags.length === 0 ? undefined : tags }),
    [patchFilter]
  )
  const setSprintFilter = useCallback(
    (s: SprintFilterValue) => {
      let groupId: TicketFilter["groupId"]
      if (s === "all") groupId = undefined
      else if (s === "unassigned") groupId = [null]
      else groupId = [s]
      patchFilter({ groupId })
    },
    [patchFilter]
  )
  const setArchivedFilter = useCallback(
    (on: boolean) => patchFilter({ archived: on ? true : undefined }),
    [patchFilter]
  )
  const setSortKey = useCallback(
    (k: SortKey) =>
      updateQuery({
        ...latestQueryRef.current,
        sort: { key: k, dir: NATURAL_SORT_DIR[k] }
      }),
    [updateQuery]
  )

  const search = useTicketSearch(query.q, (q) =>
    updateQuery({ ...latestQueryRef.current, q })
  )
  const searchInput = search.draft
  const setSearchQuery = search.change
  const flushSearch = search.flush
  const clearSearch = search.clear
  const resetSearch = search.reset
  const clearAll = useCallback(() => {
    resetSearch()
    updateQuery({ sort: latestQueryRef.current.sort })
  }, [resetSearch, updateQuery])

  const [searchFocused, setSearchFocused] = useState(false)
  const compact = searchFocused || searchInput.length > 0

  const searchRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setWidth(Math.round(el.getBoundingClientRect().width))
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const next = Math.round(entry.contentRect.width)
      setWidth((w) => (w === next ? w : next))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [dimensions, setDimensions] = useState<ReadonlySet<FilterDimension>>(
    () => new Set()
  )
  const declareDimensions = useCallback(
    (next: ReadonlySet<FilterDimension>) => setDimensions(next),
    []
  )

  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const statuses: ReadonlyArray<ProjectStatus> = Result.isSuccess(
    statusesResult
  )
    ? statusesResult.value
    : EMPTY_STATUSES

  const measured = width > 0
  const onSameRow = measured && width >= ALL_COMPACT_FITS_ROW
  const controlsCompact = measured
    ? onSameRow
      ? compact || width < FULL_FITS_ROW
      : width < COMPACT_FITS_WRAPPED
    : false

  const activeFilterCount =
    (dimensions.has("type") && typeFilter !== "all" ? 1 : 0) +
    (dimensions.has("assignee") && assigneeFilter !== "all" ? 1 : 0) +
    (dimensions.has("tags") && selectedTags.length > 0 ? 1 : 0) +
    (dimensions.has("sprint") && sprintFilter !== "all" ? 1 : 0) +
    (dimensions.has("archived") && archivedFilter ? 1 : 0)

  const hasActiveFilters =
    status !== "all" || activeFilterCount > 0 || queryStr.length > 0

  const value = useMemo<ToolbarContextValue>(
    () => ({
      state: {
        query,
        status,
        typeFilter,
        assigneeFilter,
        selectedTags,
        sprintFilter,
        archivedFilter,
        sortKey,
        searchInput,
        counts,
        statuses,
        members,
        viewerId,
        measured,
        compact,
        controlsCompact,
        activeFilterCount,
        hasActiveFilters,
        searchBelowMinChars:
          searchInput.length > 0 && searchInput.length < MIN_SEARCH_CHARS
      },
      actions: {
        setStatus,
        setTypeFilter,
        setAssigneeFilter,
        setSelectedTags,
        setSprintFilter,
        setArchivedFilter,
        setSortKey,
        setSearchQuery,
        setSearchFocused,
        flushSearch,
        clearSearch,
        clearAll,
        declareDimensions
      },
      meta: { orgSlug, slug, containerRef, searchRef }
    }),
    [
      query,
      status,
      typeFilter,
      assigneeFilter,
      selectedTags,
      sprintFilter,
      archivedFilter,
      sortKey,
      searchInput,
      counts,
      statuses,
      members,
      viewerId,
      measured,
      compact,
      controlsCompact,
      activeFilterCount,
      hasActiveFilters,
      setStatus,
      setTypeFilter,
      setAssigneeFilter,
      setSelectedTags,
      setSprintFilter,
      setArchivedFilter,
      setSortKey,
      setSearchQuery,
      flushSearch,
      clearSearch,
      clearAll,
      declareDimensions,
      orgSlug,
      slug
    ]
  )

  return <ToolbarContext value={value}>{children}</ToolbarContext>
}

type ControlsLayout = "hug" | "fill"

const ControlsLayoutContext = createContext<ControlsLayout>("hug")

export const ControlsLayoutProvider = ControlsLayoutContext

export function useControlsLayout(): ControlsLayout {
  return use(ControlsLayoutContext)
}

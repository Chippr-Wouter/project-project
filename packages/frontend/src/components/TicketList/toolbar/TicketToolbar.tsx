import { useLayoutEffect, useRef, useState } from "react"
import {
  NATURAL_SORT_DIR,
  type Member,
  type TicketFilter,
  type TicketListQuery
} from "@projectproject/shared"
import { useTicketSearch } from "../search"
import { activeFilterCount, pruneFilter, type FilterDimension } from "./model"
import { Filters } from "./Filters"
import { ClearAll, SearchInput, Sort, Status } from "./parts"

export function TicketToolbar({
  orgSlug,
  slug,
  query,
  onQueryChange,
  members,
  counts,
  filters,
  showSort = false
}: {
  orgSlug: string
  slug: string
  query: TicketListQuery
  onQueryChange: (query: TicketListQuery) => void
  members: ReadonlyArray<Member>
  counts: Record<string, number>
  filters: ReadonlyArray<FilterDimension>
  showSort?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [focused, setFocused] = useState(false)
  const search = useTicketSearch(query.q, (q) => onQueryChange({ ...query, q }))
  const searchActive = focused || search.draft.length > 0
  const measured = width > 0
  const controlsCompact =
    measured && (width >= 460 ? searchActive || width < 720 : width < 360)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return undefined
    setWidth(Math.round(element.getBoundingClientRect().width))
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const patchFilter = (patch: Partial<TicketFilter>) => {
    onQueryChange({
      ...query,
      filter: pruneFilter({ ...query.filter, ...patch })
    })
  }
  const clearAll = () => {
    search.reset()
    onQueryChange({ sort: query.sort })
  }
  const hasActiveFilters =
    !!query.filter?.status?.length ||
    activeFilterCount(query.filter, filters) > 0 ||
    !!query.q

  return (
    <div
      ref={containerRef}
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
    >
      <SearchInput
        value={search.draft}
        onChange={search.change}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          search.flush()
        }}
        onClear={search.clear}
        active={searchActive}
      />
      {measured && (
        <div className="relative flex flex-wrap items-center gap-2">
          <Status
            value={query.filter?.status}
            onChange={(status) => patchFilter({ status })}
            counts={counts}
            orgSlug={orgSlug}
            slug={slug}
            compact={controlsCompact}
          />
          <Filters
            value={query.filter}
            onChange={patchFilter}
            filters={filters}
            members={members}
            orgSlug={orgSlug}
            slug={slug}
            compact={searchActive}
          />
          {showSort && (
            <Sort
              value={query.sort}
              onChange={(key) =>
                onQueryChange({
                  ...query,
                  sort: { key, dir: NATURAL_SORT_DIR[key] }
                })
              }
              compact={controlsCompact}
            />
          )}
          <ClearAll visible={hasActiveFilters} onClick={clearAll} />
        </div>
      )}
    </div>
  )
}

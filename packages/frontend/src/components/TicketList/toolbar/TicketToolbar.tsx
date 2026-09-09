import { useLayoutEffect, useRef, useState } from "react"
import type { TicketFilter } from "@projectproject/shared"
import { useTicketSearch } from "../search"
import { activeFilterCount, pruneFilter } from "./model"
import { TicketToolbarContext, type TicketToolbarProps } from "./context"
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
}: TicketToolbarProps) {
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
    <TicketToolbarContext
      value={{
        orgSlug,
        slug,
        query,
        onQueryChange,
        members,
        counts,
        filters,
        search,
        searchActive,
        controlsCompact,
        setFocused,
        patchFilter,
        clearAll,
        hasActiveFilters
      }}
    >
      <div
        ref={containerRef}
        className="flex flex-wrap items-center gap-x-2 gap-y-2"
      >
        <SearchInput />
        {measured && (
          <div className="relative flex flex-wrap items-center gap-2">
            <Status />
            <Filters />
            {showSort && <Sort />}
            <ClearAll />
          </div>
        )}
      </div>
    </TicketToolbarContext>
  )
}

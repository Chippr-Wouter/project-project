import { createContext, use } from "react"
import type {
  Member,
  TicketFilter,
  TicketListQuery
} from "@projectproject/shared"
import type { useTicketSearch } from "../search"
import type { FilterDimension } from "./model"

export type TicketToolbarProps = {
  orgSlug: string
  slug: string
  query: TicketListQuery
  onQueryChange: (query: TicketListQuery) => void
  members: ReadonlyArray<Member>
  counts: Record<string, number>
  filters: ReadonlyArray<FilterDimension>
  showSort?: boolean
}

type TicketToolbarContextValue = Omit<TicketToolbarProps, "showSort"> & {
  search: ReturnType<typeof useTicketSearch>
  searchActive: boolean
  controlsCompact: boolean
  setFocused: (focused: boolean) => void
  patchFilter: (patch: Partial<TicketFilter>) => void
  clearAll: () => void
  hasActiveFilters: boolean
}

export const TicketToolbarContext =
  createContext<TicketToolbarContextValue | null>(null)

export function useTicketToolbar() {
  const context = use(TicketToolbarContext)
  if (!context)
    throw new Error("Toolbar controls must render inside TicketToolbar")
  return context
}

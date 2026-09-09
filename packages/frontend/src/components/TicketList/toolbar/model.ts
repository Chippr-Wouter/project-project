import type { GroupId, TicketFilter } from "@projectproject/shared"

export type SprintFilterValue = "all" | "unassigned" | GroupId
export type FilterDimension =
  | "type"
  | "assignee"
  | "tags"
  | "sprint"
  | "archived"

export function activeFilterCount(
  filter: TicketFilter | undefined,
  dimensions: ReadonlyArray<FilterDimension>
) {
  return dimensions.filter((dimension) => {
    const value = filter?.[dimension === "sprint" ? "groupId" : dimension]
    return Array.isArray(value) ? value.length > 0 : value === true
  }).length
}

export const pruneFilter = (
  f: TicketFilter | undefined
): TicketFilter | undefined => {
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

import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import { TicketStatus, TicketType } from "../schemas/Ticket"
import { TagName } from "../schemas/Tag"
import { GroupId } from "../schemas/Group"
import { Ticket } from "../schemas/Ticket"
import { Page } from "../Pagination"

export const SortKey = Schema.Literals([
  "id",
  "created",
  "updated",
  "title",
  "priority"
])
export type SortKey = typeof SortKey.Type

export const SortDir = Schema.Literals(["asc", "desc"])
export type SortDir = typeof SortDir.Type

export const TicketSort = Schema.Struct({
  key: SortKey,
  dir: SortDir
})
export type TicketSort = typeof TicketSort.Type

export const DEFAULT_TICKET_SORT: TicketSort = {
  key: "created",
  dir: "desc"
}

export const NATURAL_SORT_DIR: Record<SortKey, SortDir> = {
  id: "asc",
  created: "desc",
  updated: "desc",
  title: "asc",
  priority: "desc"
}

export const AssigneeFilter = Schema.Union([
  Schema.Literal("mine"),
  Schema.Null,
  Schema.String
])
export type AssigneeFilter = typeof AssigneeFilter.Type

export const GroupIdFilter = Schema.NullOr(GroupId)
export type GroupIdFilter = typeof GroupIdFilter.Type

export const TicketFilter = Schema.Struct({
  status: Schema.optional(Schema.Array(TicketStatus)),
  type: Schema.optional(Schema.Array(TicketType)),
  assignee: Schema.optional(Schema.Array(AssigneeFilter)),
  tags: Schema.optional(Schema.Array(TagName)),
  hasBranch: Schema.optional(Schema.Boolean),
  hasPr: Schema.optional(Schema.Boolean),
  updatedAfter: Schema.optional(Schema.DateFromString),
  groupId: Schema.optional(Schema.Array(GroupIdFilter)),
  archived: Schema.optional(Schema.Boolean)
})
export type TicketFilter = typeof TicketFilter.Type

export const TICKET_LIST_LIMIT = 50

export const TicketListQuery = Schema.Struct({
  filter: Schema.optional(TicketFilter),
  sort: TicketSort.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(DEFAULT_TICKET_SORT))
  ),
  q: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String)
})
export type TicketListQuery = typeof TicketListQuery.Type

export const TicketListPage = Page(Ticket)
export type TicketListPage = typeof TicketListPage.Type

export const TicketCounts = Schema.Struct({
  total: Schema.Finite,
  byStatus: Schema.Record(TicketStatus, Schema.Finite)
})
export type TicketCounts = typeof TicketCounts.Type

export const TicketCountQuery = Schema.Struct({
  filter: Schema.optional(TicketFilter),
  q: Schema.optional(Schema.String)
})
export type TicketCountQuery = typeof TicketCountQuery.Type

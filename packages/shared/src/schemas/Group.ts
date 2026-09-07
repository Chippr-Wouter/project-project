import * as Schema from "effect/Schema"
import { TicketId, TicketStatus } from "./Ticket"

export const GroupId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^G-[1-9][0-9]*$/)),
  Schema.brand("GroupId")
)
export type GroupId = typeof GroupId.Type

export const GroupKind = Schema.Literals([
  "sprint",
  "epic",
  "milestone",
  "other"
])
export type GroupKind = typeof GroupKind.Type

export const ADMIN_GATED_KINDS: ReadonlySet<GroupKind> = new Set([
  "sprint",
  "milestone"
])

export const GroupColor = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^#[0-9a-f]{6}$/i)),
  Schema.brand("GroupColor")
)
export type GroupColor = typeof GroupColor.Type

export const Group = Schema.Struct({
  id: GroupId,
  name: Schema.String,
  kind: GroupKind,
  tickets: Schema.Array(TicketId),
  color: GroupColor,
  startsAt: Schema.NullOr(Schema.DateFromString),
  endsAt: Schema.NullOr(Schema.DateFromString),
  completedAt: Schema.NullOr(Schema.DateFromString),
  createdBy: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString
})
export type Group = typeof Group.Type

export const GroupDetail = Schema.Struct({
  ...Group.fields,
  body: Schema.String
})
export type GroupDetail = typeof GroupDetail.Type

export const CreateGroupInput = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200))
  ),
  kind: Schema.optional(GroupKind),
  color: Schema.optional(GroupColor),
  startsAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  endsAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  tickets: Schema.optional(Schema.Array(TicketId))
})
export type CreateGroupInput = typeof CreateGroupInput.Type

export const UpdateGroupInput = Schema.Struct({
  name: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(200))
    )
  ),
  body: Schema.optional(Schema.String),
  color: Schema.optional(GroupColor),
  startsAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  endsAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  completedAt: Schema.optional(Schema.NullOr(Schema.DateFromString))
})
export type UpdateGroupInput = typeof UpdateGroupInput.Type

export const UpdateGroupTicketsInput = Schema.Struct({
  tickets: Schema.Array(TicketId)
})
export type UpdateGroupTicketsInput = typeof UpdateGroupTicketsInput.Type

export const EvictedFromGroup = Schema.Struct({
  groupId: GroupId,
  ticketIds: Schema.Array(TicketId)
})
export type EvictedFromGroup = typeof EvictedFromGroup.Type

export const UpdateGroupTicketsOutput = Schema.Struct({
  target: GroupDetail,
  evicted: Schema.Array(EvictedFromGroup)
})
export type UpdateGroupTicketsOutput = typeof UpdateGroupTicketsOutput.Type

export const UpdateTicketOrderInput = Schema.Struct({
  ticketId: TicketId,
  status: Schema.optional(TicketStatus),
  after: Schema.NullOr(TicketId)
})
export type UpdateTicketOrderInput = typeof UpdateTicketOrderInput.Type

export const CompleteSprintDestination = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("sprint"), groupId: GroupId }),
  Schema.Struct({ kind: Schema.Literal("backlog") })
])
export type CompleteSprintDestination = typeof CompleteSprintDestination.Type

export const CompleteSprintInput = Schema.Struct({
  destination: CompleteSprintDestination
})
export type CompleteSprintInput = typeof CompleteSprintInput.Type

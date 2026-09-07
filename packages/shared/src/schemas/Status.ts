import * as Schema from "effect/Schema"
import { TagColor } from "./Tag"

export const BASELINE_STATUS_SLUGS = ["todo", "in_progress", "done"] as const
export type BaselineStatusSlug = (typeof BASELINE_STATUS_SLUGS)[number]

export const StatusSlug = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9_]+$/)),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(40)),
  Schema.brand("StatusSlug")
)
export type StatusSlug = typeof StatusSlug.Type

export const StatusLabel = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(40)),
  Schema.brand("StatusLabel")
)
export type StatusLabel = typeof StatusLabel.Type

export const STATUS_ICONS = [
  "Circle",
  "CircleDot",
  "CircleDashed",
  "CircleDotDashed",
  "CircleCheck",
  "Loader",
  "Hourglass",
  "Timer",
  "Eye",
  "Search",
  "ScanLine",
  "Microscope",
  "ShieldCheck",
  "Ban",
  "AlertCircle",
  "AlertTriangle",
  "Lock",
  "XCircle",
  "Archive",
  "Skull",
  "Trash",
  "Lightbulb",
  "Bookmark",
  "Inbox",
  "Trophy",
  "Sparkles",
  "Rocket",
  "Flame",
  "Award",
  "Square",
  "Triangle",
  "Hexagon",
  "Diamond"
] as const
export type StatusIconName = (typeof STATUS_ICONS)[number]

export const StatusIcon = Schema.Literals(STATUS_ICONS)

export const StatusIconValue = Schema.String

export const StatusColor = TagColor

export const OrderKey = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(64)),
  Schema.brand("OrderKey")
)
export type OrderKey = typeof OrderKey.Type

export const ProjectStatus = Schema.Struct({
  slug: StatusSlug,
  label: StatusLabel,
  icon: StatusIconValue,
  color: StatusColor,
  orderKey: OrderKey,
  createdBy: Schema.String,
  createdAt: Schema.DateFromString
})
export type ProjectStatus = typeof ProjectStatus.Type

export const CreateStatusInput = Schema.Struct({
  label: StatusLabel,
  icon: Schema.optional(StatusIcon),
  color: Schema.optional(StatusColor)
})
export type CreateStatusInput = typeof CreateStatusInput.Type

export const UpdateStatusInput = Schema.Struct({
  label: Schema.optional(StatusLabel),
  icon: Schema.optional(StatusIcon),
  color: Schema.optional(StatusColor)
})
export type UpdateStatusInput = typeof UpdateStatusInput.Type

export const ReorderStatusInput = Schema.Struct({
  orderKey: OrderKey
})
export type ReorderStatusInput = typeof ReorderStatusInput.Type

export const DeleteStatusInput = Schema.Struct({
  reassignTo: Schema.optional(StatusSlug)
})
export type DeleteStatusInput = typeof DeleteStatusInput.Type

import * as Schema from "effect/Schema"

export const WorkType = Schema.Struct({
  key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z][a-z0-9_]*$/))),
  label: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(100))
  ),
  order: Schema.Finite,
  isDefault: Schema.Boolean
})
export type WorkType = typeof WorkType.Type

export const OrgEverhourConfig = Schema.Struct({
  workTypes: Schema.Array(WorkType)
})
export type OrgEverhourConfig = typeof OrgEverhourConfig.Type

export const DEFAULT_WORK_TYPES: ReadonlyArray<WorkType> = [
  { key: "development", label: "Development", order: 0, isDefault: true },
  { key: "design", label: "Design", order: 1, isDefault: false },
  {
    key: "project_management",
    label: "Project Management",
    order: 2,
    isDefault: false
  },
  {
    key: "meetings",
    label: "Meetings & Workshops",
    order: 3,
    isDefault: false
  },
  { key: "testing", label: "Testing", order: 4, isDefault: false }
]

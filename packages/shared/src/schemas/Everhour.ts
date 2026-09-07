import * as Schema from "effect/Schema"

export const PersonalEverhour = Schema.Struct({
  connected: Schema.Boolean,
  everhourUserId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  lastVerifiedAt: Schema.NullOr(Schema.DateFromString),
  lastCheckError: Schema.NullOr(Schema.String)
})
export type PersonalEverhour = typeof PersonalEverhour.Type

export const EverhourProjectIntegrationStatus = Schema.Struct({
  status: Schema.Literals(["not_connected", "active", "broken"]),
  everhourProjectId: Schema.NullOr(Schema.String),
  everhourProjectName: Schema.NullOr(Schema.String),
  lastSyncedAt: Schema.NullOr(Schema.DateFromString),
  lastSyncStatus: Schema.NullOr(Schema.Literals(["ok", "error"])),
  lastSyncError: Schema.NullOr(Schema.String),
  needsSync: Schema.Boolean
})
export type EverhourProjectIntegrationStatus =
  typeof EverhourProjectIntegrationStatus.Type

export const EverhourSyncSummary = Schema.Struct({
  sectionsCreated: Schema.Finite,
  sectionsUpdated: Schema.Finite,
  sectionsArchived: Schema.Finite,
  tasksCreated: Schema.Finite,
  tasksUpdated: Schema.Finite,
  tasksClosed: Schema.Finite,
  tasksRecreated: Schema.Finite,
  tasksSkipped: Schema.Finite,
  errors: Schema.Array(Schema.String)
})
export type EverhourSyncSummary = typeof EverhourSyncSummary.Type

export const ConnectEverhourProfileInput = Schema.Struct({
  apiKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1)))
})
export type ConnectEverhourProfileInput =
  typeof ConnectEverhourProfileInput.Type

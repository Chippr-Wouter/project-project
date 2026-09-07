// Output schema for the MCP `me` tool: the authenticated user plus their
// role in each org they belong to. We reuse the three-tier `Role` literal
// from `schemas/Project` — the spec uses the same owner/admin/member tiers
// at both the org and project levels, so duplicating the literal would just
// invite drift.

import * as Schema from "effect/Schema"
import { Role } from "../schemas/Project"
import { User } from "../schemas/User"

export const MeRole = Schema.Struct({
  orgSlug: Schema.String,
  role: Role
})
export type MeRole = typeof MeRole.Type

export const MeOutput = Schema.Struct({
  user: User,
  roles: Schema.Array(MeRole)
})
export type MeOutput = typeof MeOutput.Type

import * as Schema from "effect/Schema"
import { Slug } from "../schemas/Project"

export const TicketIndexDrift = Schema.Struct({
  missing: Schema.Array(Schema.String),
  orphaned: Schema.Array(Schema.String),
  stale: Schema.Array(Schema.String)
})
export type TicketIndexDrift = typeof TicketIndexDrift.Type

export const RebuildTicketIndexOutput = Schema.Struct({
  orgSlug: Slug,
  projectSlug: Slug,
  rebuilt: Schema.Boolean,
  indexed: Schema.Finite,
  skipped: Schema.Finite,
  drift: TicketIndexDrift
})
export type RebuildTicketIndexOutput = typeof RebuildTicketIndexOutput.Type

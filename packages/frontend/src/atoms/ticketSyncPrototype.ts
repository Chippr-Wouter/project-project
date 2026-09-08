import * as Schema from "effect/Schema"
import {
  TicketSyncSnapshotPrototype,
  type TicketSyncDeltaPrototype
} from "@projectproject/shared"
type Snapshot = typeof TicketSyncSnapshotPrototype.Type
type Delta = typeof TicketSyncDeltaPrototype.Type
export type TicketSyncParamsPrototype = {
  readonly orgSlug: string
  readonly slug: string
}
export type TicketSyncOwnerPrototype = {
  readonly server: string
  readonly userId: string
  readonly generation: number
}
export type TicketSyncAuthTokenPrototype = {
  readonly generation: number
  readonly owner: TicketSyncOwnerPrototype | null
}
export class TicketSyncAuthChangedPrototype extends Schema.TaggedError<TicketSyncAuthChangedPrototype>()(
  "TicketSyncAuthChangedPrototype",
  {}
) {}

export const ticketSyncPrototypeEnabled =
  import.meta.env.VITE_TICKET_SYNC_PROTOTYPE === "true" &&
  import.meta.env.VITE_TICKET_REPLICA_PROTOTYPE === "true" &&
  typeof location !== "undefined" &&
  location.hostname === "localhost"

export function applyTicketDeltaPrototype(
  base: Snapshot,
  delta: Delta
): Snapshot {
  if (
    delta.reset ||
    delta.checkpoint.epoch !== base.checkpoint.epoch ||
    delta.checkpoint.revision < base.checkpoint.revision
  )
    throw new Error("Invalid delta checkpoint")
  const items = new Map(base.items.map((ticket) => [ticket.id, ticket]))
  for (const id of delta.deleted) items.delete(id)
  for (const ticket of delta.items) items.set(ticket.id, ticket)
  return {
    checkpoint: delta.checkpoint,
    items: [...items.values()].toSorted(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id)
    )
  }
}

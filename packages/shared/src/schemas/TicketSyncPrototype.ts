import * as Schema from "effect/Schema"
import { Ticket, TicketId } from "./Ticket"

export const TicketSyncCheckpointPrototype = Schema.Struct({
  epoch: Schema.String,
  revision: Schema.Int
})

export const TicketSyncSnapshotPrototype = Schema.Struct({
  checkpoint: TicketSyncCheckpointPrototype,
  items: Schema.Array(Ticket)
})

export const TicketSyncDeltaPrototype = Schema.Struct({
  checkpoint: TicketSyncCheckpointPrototype,
  items: Schema.Array(Ticket),
  deleted: Schema.Array(TicketId),
  reset: Schema.Boolean,
  hasMore: Schema.Boolean
})

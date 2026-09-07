import { describe, expect, it } from "vite-plus/test"
import * as Schema from "effect/Schema"
import { reconcilePendingTicketStatuses } from "./pendingTicketStatus"
import type { TicketId, TicketStatus } from "@projectproject/shared"
import { TicketId as TicketIdSchema, StatusSlug } from "@projectproject/shared"

const ticketId = Schema.decodeUnknownSync(TicketIdSchema)
const status = Schema.decodeUnknownSync(StatusSlug)

describe("reconcilePendingTicketStatuses", () => {
  it("keeps a pending status while fetched ticket data still has the old status", () => {
    const pending = new Map<TicketId, TicketStatus>([
      [ticketId("T-1"), status("in_progress")]
    ])

    expect(
      reconcilePendingTicketStatuses(pending, [
        { id: ticketId("T-1"), status: status("todo") }
      ])
    ).toBe(pending)
  })

  it("clears a pending status once fetched ticket data catches up", () => {
    const pending = new Map<TicketId, TicketStatus>([
      [ticketId("T-1"), status("in_progress")],
      [ticketId("T-2"), status("done")]
    ])

    expect(
      reconcilePendingTicketStatuses(pending, [
        { id: ticketId("T-1"), status: status("in_progress") },
        { id: ticketId("T-2"), status: status("todo") }
      ])
    ).toEqual(new Map([[ticketId("T-2"), status("done")]]))
  })
})

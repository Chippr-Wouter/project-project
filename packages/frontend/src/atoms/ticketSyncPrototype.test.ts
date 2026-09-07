import { describe, expect, it } from "vitest"
import * as Schema from "effect/Schema"
import { Ticket, TicketId } from "@projectproject/shared"
import { applyTicketDeltaPrototype } from "./ticketSyncPrototype"

const ticket = Schema.decodeUnknownSync(Ticket)({
  id: "T-1",
  title: "Original",
  status: "todo",
  type: "chore",
  priority: "med",
  tags: [],
  assignees: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  gitState: { tag: "no_branch", baseBranch: "" },
  archivedAt: null,
  createdBy: "measure-user",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
})

describe("ticket sync prototype delta application", () => {
  it("replays updates and deletions idempotently", () => {
    const base = { checkpoint: { epoch: "test", revision: 0 }, items: [ticket] }
    const delta = {
      checkpoint: { epoch: "test", revision: 2 },
      items: [
        {
          ...ticket,
          id: Schema.decodeUnknownSync(TicketId)("T-2"),
          title: "Created"
        }
      ],
      deleted: [ticket.id],
      reset: false,
      hasMore: false
    }
    const next = applyTicketDeltaPrototype(base, delta)
    expect(next.items.map((t) => t.id)).toEqual(["T-2"])
    expect(applyTicketDeltaPrototype(next, delta)).toEqual(next)
  })
  it("rejects a delta from an older checkpoint or another epoch", () => {
    const base = { checkpoint: { epoch: "test", revision: 2 }, items: [ticket] }
    const delta = {
      checkpoint: { epoch: "test", revision: 1 },
      items: [],
      deleted: [],
      reset: false,
      hasMore: false
    }
    expect(() => applyTicketDeltaPrototype(base, delta)).toThrow()
    expect(() =>
      applyTicketDeltaPrototype(base, {
        ...delta,
        checkpoint: { epoch: "other", revision: 3 }
      })
    ).toThrow()
  })
})

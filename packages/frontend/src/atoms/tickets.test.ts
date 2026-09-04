import { Registry } from "@effect-atom/atom-react"
import { describe, expect, it } from "vitest"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import {
  TicketId,
  TicketStatus,
  type TicketDetail
} from "@projectproject/shared"
import {
  applyOptimisticTicketPreview,
  applyOptimisticTicketUpdate,
  ticketKey,
  ticketUpdatePreviewAtom,
  updateTicketAtom,
  updateTicketStatusAtom
} from "./tickets"

const ticket = {
  id: Schema.decodeUnknownSync(TicketId)("T-1"),
  title: "Before",
  status: Schema.decodeUnknownSync(TicketStatus)("todo"),
  type: "chore",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  gitState: { tag: "no_branch", baseBranch: "main" },
  assignees: [],
  archivedAt: null,
  createdBy: "user-1",
  createdAt: DateTime.toDate(DateTime.unsafeMake("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.unsafeMake("2026-01-01T00:00:00.000Z")),
  body: "Before"
} satisfies TicketDetail

describe("applyOptimisticTicketUpdate", () => {
  it("applies the visible patch while preserving server-owned fields", () => {
    expect(
      applyOptimisticTicketUpdate(ticket, {
        title: "After",
        body: "After",
        priority: "high"
      })
    ).toEqual({
      ...ticket,
      title: "After",
      body: "After",
      priority: "high"
    })
  })

  it("applies the same visible patch to list tickets", () => {
    const { body: _body, ...listTicket } = ticket

    expect(
      applyOptimisticTicketPreview(listTicket, {
        priority: "high",
        type: "bug",
        assignees: ["user-2"]
      })
    ).toEqual({
      ...listTicket,
      priority: "high",
      type: "bug",
      assignees: ["user-2"]
    })
  })

  it("publishes list-visible updates synchronously", () => {
    const registry = Registry.make()
    const key = ticketKey("org", "project", ticket.id)
    const preview = ticketUpdatePreviewAtom(key)
    const dispose = registry.mount(preview)

    registry.set(updateTicketAtom(key), { priority: "high" })

    expect(registry.get(preview)).toEqual({
      input: { priority: "high" },
      waiting: true
    })
    dispose()
  })

  it("publishes status updates through the same optimistic preview", () => {
    const registry = Registry.make()
    const key = ticketKey("org", "project", ticket.id)
    const preview = ticketUpdatePreviewAtom(key)
    const dispose = registry.mount(preview)

    registry.set(updateTicketStatusAtom(key), {
      status: Schema.decodeUnknownSync(TicketStatus)("in_progress"),
      sourceSectionKey: "source",
      destSectionKey: "destination"
    })

    expect(registry.get(preview)).toEqual({
      input: { status: "in_progress" },
      waiting: true
    })
    dispose()
  })
})

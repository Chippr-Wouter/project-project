import { describe, expect, it } from "vite-plus/test"
import * as Schema from "effect/Schema"
import { reconcilePendingSprintAssignments } from "./pendingSprintAssignment"
import type { GroupId, TicketId } from "@projectproject/shared"
import {
  GroupId as GroupIdSchema,
  TicketId as TicketIdSchema
} from "@projectproject/shared"

const ticketId = Schema.decodeUnknownSync(TicketIdSchema)
const groupId = Schema.decodeUnknownSync(GroupIdSchema)

const sprint = (
  id: GroupId,
  tickets: ReadonlyArray<TicketId>,
  completedAt: Date | null = null
) => ({ id, tickets, completedAt })

describe("reconcilePendingSprintAssignments", () => {
  it("keeps a pending assignment while server has not caught up", () => {
    const a = groupId("G-1")
    const t1 = ticketId("T-1")
    const pending = new Map<TicketId, GroupId | null>([[t1, a]])

    expect(reconcilePendingSprintAssignments(pending, [sprint(a, [])])).toBe(
      pending
    )
  })

  it("clears a pending assignment once the sprint membership matches", () => {
    const a = groupId("G-1")
    const b = groupId("G-2")
    const t1 = ticketId("T-1")
    const t2 = ticketId("T-2")
    const pending = new Map<TicketId, GroupId | null>([
      [t1, a],
      [t2, b]
    ])

    const next = reconcilePendingSprintAssignments(pending, [
      sprint(a, [t1]),
      sprint(b, [])
    ])
    expect(next.has(t1)).toBe(false)
    expect(next.get(t2)).toBe(b)
  })

  it("clears a pending removal once the ticket is no longer in any sprint", () => {
    const a = groupId("G-1")
    const t1 = ticketId("T-1")
    const pending = new Map<TicketId, GroupId | null>([[t1, null]])

    const next = reconcilePendingSprintAssignments(pending, [sprint(a, [])])
    expect(next.has(t1)).toBe(false)
  })

  it("keeps a pending removal while the ticket is still in a sprint", () => {
    const a = groupId("G-1")
    const t1 = ticketId("T-1")
    const pending = new Map<TicketId, GroupId | null>([[t1, null]])

    expect(reconcilePendingSprintAssignments(pending, [sprint(a, [t1])])).toBe(
      pending
    )
  })

  it("ignores completed sprints when reading server membership", () => {
    const a = groupId("G-1")
    const t1 = ticketId("T-1")
    const pending = new Map<TicketId, GroupId | null>([[t1, null]])

    // @effect-diagnostics-next-line globalDate:off
    const completedAt = new Date()
    const next = reconcilePendingSprintAssignments(pending, [
      sprint(a, [t1], completedAt)
    ])
    expect(next.has(t1)).toBe(false)
  })
})

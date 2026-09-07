import { Result } from "@effect-atom/atom-react"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vite-plus/test"
import { GroupId, TicketId, type ActiveTimer } from "@projectproject/shared"
import { optimisticStopTimer, ticketTimeKeysForTimers } from "./timeTracking"

const groupId = Schema.decodeUnknownSync(GroupId)("G-1")
const ticketId = Schema.decodeUnknownSync(TicketId)

const timer = (id: ActiveTimer["ticketId"]): ActiveTimer => ({
  slug: "project",
  ticketId: id,
  ticketTitle: id,
  groupId,
  workTypeKey: "development",
  workTypeLabel: "Development",
  everhourTaskId: "task-1",
  startedAt: DateTime.toDate(DateTime.unsafeMake("2026-06-22T10:00:00Z"))
})

describe("ticketTimeKeysForTimers", () => {
  it("refreshes the previous ticket when a timer switches", () => {
    expect(ticketTimeKeysForTimers("acme", [timer(ticketId("OLD-1"))])).toEqual(
      ["acme/project/OLD-1"]
    )
  })

  it("ignores sprint timers and removes duplicate ticket keys", () => {
    const ticketTimer = timer(ticketId("T-1"))
    expect(
      ticketTimeKeysForTimers("acme", [
        null,
        timer(null),
        ticketTimer,
        ticketTimer
      ])
    ).toEqual(["acme/project/T-1"])
  })
})

describe("optimisticStopTimer", () => {
  it("retains the active timer while stop is pending", () => {
    const active = timer(ticketId("T-1"))
    const result = optimisticStopTimer(Result.success(active))
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) {
      expect(result.value).toBe(active)
      expect(result.waiting).toBe(true)
    }
  })
})

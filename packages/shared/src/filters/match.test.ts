import { describe, expect, it } from "vite-plus/test"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import type { Ticket } from "../schemas/Ticket"
import { TagName } from "../schemas/Tag"
import { TicketId } from "../schemas/Ticket"
import { StatusSlug } from "../schemas/Status"
import type { TicketFilter, TicketListQuery } from "./Ticket"
import {
  matchesTicketFilter,
  matchesTicketQuery,
  type MatchableTicket
} from "./match"

const decodeTicketId = Schema.decodeUnknownSync(TicketId)
const decodeTagName = Schema.decodeUnknownSync(TagName)
const s = Schema.decodeUnknownSync(StatusSlug)
const isoDate = (s: string) => DateTime.toDate(DateTime.unsafeMake(s))

const baseTicket = (overrides: Partial<Ticket> = {}): Ticket => ({
  id: decodeTicketId("T-1"),
  title: "Test",
  status: s("todo"),
  type: "feat",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  gitState: { tag: "no_branch" },
  assignees: [],
  archivedAt: null,
  createdBy: "user-1",
  createdAt: isoDate("2026-05-01T00:00:00.000Z"),
  updatedAt: isoDate("2026-05-10T00:00:00.000Z"),
  ...overrides
})

describe("matchesTicketFilter", () => {
  it("undefined filter matches everything", () => {
    expect(matchesTicketFilter(baseTicket(), undefined)).toBe(true)
  })

  it("empty filter object matches everything", () => {
    expect(matchesTicketFilter(baseTicket(), {})).toBe(true)
  })

  it("status filter ORs across entries", () => {
    const t = baseTicket({ status: s("in_progress") })
    const f: TicketFilter = { status: [s("in_progress"), s("done")] }
    expect(matchesTicketFilter(t, f)).toBe(true)
    expect(matchesTicketFilter(baseTicket({ status: s("todo") }), f)).toBe(
      false
    )
  })

  it("empty status array matches nothing", () => {
    expect(matchesTicketFilter(baseTicket(), { status: [] })).toBe(false)
  })

  it("type filter ORs across entries", () => {
    const f: TicketFilter = { type: ["bug"] }
    expect(matchesTicketFilter(baseTicket({ type: "bug" }), f)).toBe(true)
    expect(matchesTicketFilter(baseTicket({ type: "feat" }), f)).toBe(false)
  })

  it("assignee: null entry matches unassigned tickets", () => {
    const t = baseTicket({ assignees: [] })
    expect(matchesTicketFilter(t, { assignee: [null] })).toBe(true)
    expect(matchesTicketFilter(t, { assignee: ["alice"] })).toBe(false)
  })

  it("assignee mix matches union of unassigned + named", () => {
    const f: TicketFilter = { assignee: [null, "alice"] }
    expect(matchesTicketFilter(baseTicket({ assignees: [] }), f)).toBe(true)
    expect(matchesTicketFilter(baseTicket({ assignees: ["alice"] }), f)).toBe(
      true
    )
    expect(matchesTicketFilter(baseTicket({ assignees: ["bob"] }), f)).toBe(
      false
    )
  })

  it("tags filter ORs across entries (any tag in common wins)", () => {
    const t = baseTicket({
      tags: [decodeTagName("bug"), decodeTagName("perf")]
    })
    expect(matchesTicketFilter(t, { tags: [decodeTagName("bug")] })).toBe(true)
    expect(matchesTicketFilter(t, { tags: [decodeTagName("ui")] })).toBe(false)
  })

  it("hasBranch true requires non-null branch", () => {
    expect(
      matchesTicketFilter(baseTicket({ branch: "feat/x" }), { hasBranch: true })
    ).toBe(true)
    expect(
      matchesTicketFilter(baseTicket({ branch: null }), { hasBranch: true })
    ).toBe(false)
  })

  it("hasBranch false requires null branch", () => {
    expect(
      matchesTicketFilter(baseTicket({ branch: null }), { hasBranch: false })
    ).toBe(true)
    expect(
      matchesTicketFilter(baseTicket({ branch: "feat/x" }), {
        hasBranch: false
      })
    ).toBe(false)
  })

  it("hasPr mirrors hasBranch against pr", () => {
    expect(matchesTicketFilter(baseTicket({ pr: 7 }), { hasPr: true })).toBe(
      true
    )
    expect(matchesTicketFilter(baseTicket({ pr: null }), { hasPr: true })).toBe(
      false
    )
  })

  it("updatedAfter is strict greater-than", () => {
    const t = baseTicket({ updatedAt: isoDate("2026-05-10T00:00:00.000Z") })
    expect(
      matchesTicketFilter(t, {
        updatedAfter: isoDate("2026-05-09T00:00:00.000Z")
      })
    ).toBe(true)
    expect(
      matchesTicketFilter(t, {
        updatedAfter: isoDate("2026-05-10T00:00:00.000Z")
      })
    ).toBe(false)
    expect(
      matchesTicketFilter(t, {
        updatedAfter: isoDate("2026-05-11T00:00:00.000Z")
      })
    ).toBe(false)
  })

  it("ANDs across fields", () => {
    const t = baseTicket({ status: s("in_progress"), type: "bug" })
    expect(
      matchesTicketFilter(t, { status: [s("in_progress")], type: ["bug"] })
    ).toBe(true)
    expect(
      matchesTicketFilter(t, { status: [s("in_progress")], type: ["feat"] })
    ).toBe(false)
  })
})

describe("matchesTicketQuery", () => {
  it("empty query matches everything", () => {
    expect(matchesTicketQuery(baseTicket(), {}, "user-a")).toBe(true)
  })

  it("hides archived tickets by default", () => {
    const archived = baseTicket({
      archivedAt: isoDate("2026-05-11T00:00:00.000Z")
    })
    expect(matchesTicketQuery(archived, {}, "user-a")).toBe(false)
    expect(matchesTicketQuery(baseTicket(), {}, "user-a")).toBe(true)
  })

  it("shows only archived tickets when archived filter is set", () => {
    const archived = baseTicket({
      archivedAt: isoDate("2026-05-11T00:00:00.000Z")
    })
    const active = baseTicket()
    expect(
      matchesTicketQuery(archived, { filter: { archived: true } }, "user-a")
    ).toBe(true)
    expect(
      matchesTicketQuery(active, { filter: { archived: true } }, "user-a")
    ).toBe(false)
  })

  it("q matches on title case-insensitively", () => {
    const t = baseTicket({ title: "Hello world" })
    expect(matchesTicketQuery(t, { q: "HELLO" }, "user-a")).toBe(true)
    expect(matchesTicketQuery(t, { q: "goodbye" }, "user-a")).toBe(false)
  })

  it("q matches on id case-insensitively", () => {
    const t = baseTicket({ id: decodeTicketId("T-1"), title: "Something else" })
    expect(matchesTicketQuery(t, { q: "t-1" }, "user-a")).toBe(true)
  })

  it("'mine' resolves to viewer id in assignee filter", () => {
    const t = baseTicket({ assignees: ["user-a"] })
    expect(
      matchesTicketQuery(t, { filter: { assignee: ["mine"] } }, "user-a")
    ).toBe(true)
    expect(
      matchesTicketQuery(t, { filter: { assignee: ["mine"] } }, "user-b")
    ).toBe(false)
  })

  it("null in assignee still means unassigned via delegation", () => {
    const unassigned = baseTicket({ assignees: [] })
    const assigned = baseTicket({ assignees: ["user-a"] })
    expect(
      matchesTicketQuery(unassigned, { filter: { assignee: [null] } }, "user-a")
    ).toBe(true)
    expect(
      matchesTicketQuery(assigned, { filter: { assignee: [null] } }, "user-a")
    ).toBe(false)
  })

  it("ANDs q and filter — both must match", () => {
    const ticket = baseTicket({ status: s("in_progress"), title: "hello" })
    const both: Pick<TicketListQuery, "filter" | "q"> = {
      filter: { status: [s("in_progress")] },
      q: "hello"
    }
    expect(matchesTicketQuery(ticket, both, "user-a")).toBe(true)

    expect(
      matchesTicketQuery(
        ticket,
        { filter: { status: [s("todo")] }, q: "hello" },
        "user-a"
      )
    ).toBe(false)
    expect(
      matchesTicketQuery(
        ticket,
        { filter: { status: [s("in_progress")] }, q: "goodbye" },
        "user-a"
      )
    ).toBe(false)
  })

  it("q does not match across title/id boundary", () => {
    const t = baseTicket({ id: decodeTicketId("T-1"), title: "Hello world" })
    expect(matchesTicketQuery(t, { q: "world T" }, "user-a")).toBe(false)
    expect(matchesTicketQuery(t, { q: "world t" }, "user-a")).toBe(false)
  })

  it("whitespace-only q is a no-op", () => {
    const t = baseTicket({ title: "Hello world" })
    expect(matchesTicketQuery(t, { q: "   " }, "user-a")).toBe(true)
    expect(matchesTicketQuery(t, { q: " " }, "user-a")).toBe(true)
  })

  it("accepts a MatchableTicket without ticket-only fields", () => {
    const predicted: MatchableTicket = {
      id: "",
      title: "new ticket",
      status: s("todo"),
      type: "feat",
      tags: [],
      branch: null,
      pr: null,
      prState: null,
      assignees: [],
      archivedAt: null,
      updatedAt: isoDate("2026-05-10T00:00:00.000Z")
    }
    expect(
      matchesTicketQuery(
        predicted,
        { filter: { status: [s("todo")] } },
        "user-a"
      )
    ).toBe(true)
    expect(
      matchesTicketQuery(
        predicted,
        { filter: { status: [s("done")] } },
        "user-a"
      )
    ).toBe(false)
    expect(matchesTicketQuery(predicted, { q: "anything" }, "user-a")).toBe(
      false
    )
  })
})

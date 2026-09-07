import { Registry, Result } from "@effect-atom/atom-react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import { TicketId, TicketStatus, TicketDetail } from "@projectproject/shared"
import {
  applyOptimisticTicketPreview,
  applyOptimisticTicketUpdate,
  hydrateTicketAtom,
  ticketAtom,
  ticketKey,
  ticketsCountKey,
  ticketsListKeyForStatus,
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

afterEach(() => vi.unstubAllGlobals())

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
      ticket,
      countKey: ticketsCountKey("org", "project", {}),
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

  it("publishes a created ticket into the detail atom synchronously", () => {
    const scheduled: Array<() => void> = []
    const registry = Registry.make({
      scheduleTask: (task) => scheduled.push(task),
      timeoutResolution: 1
    })
    const key = ticketKey("org", "project", ticket.id)
    const detail = ticketAtom(key)

    registry.set(hydrateTicketAtom(key), ticket)
    while (scheduled.length > 0) scheduled.shift()?.()

    expect(registry.get(detail)).toMatchObject({
      _tag: "Success",
      value: ticket,
      waiting: true
    })
    registry.dispose()
  })

  it.each(["fields", "status"] as const)(
    "shows pending %s edits and releases them after confirmation",
    async (kind) => {
      const registry = Registry.make()
      const key = ticketKey("org", "project", ticket.id)
      const detail = ticketAtom(key)
      const preview = ticketUpdatePreviewAtom(key)
      let server: TicketDetail = ticket
      let finishUpdate: (response: Response) => void = vi.fn()
      const response = () =>
        Response.json(Schema.encodeSync(TicketDetail)(server))
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "PATCH") {
            return new Promise<Response>((resolve) => {
              finishUpdate = resolve
            })
          }
          const url = new URL(
            input instanceof Request ? input.url : String(input)
          )
          if (url.pathname.endsWith("/count")) {
            return Promise.resolve(
              Response.json({ total: 1, byStatus: { [server.status]: 1 } })
            )
          }
          if (url.pathname.endsWith("/tickets")) {
            const matches = url.searchParams.get("status") === server.status
            return Promise.resolve(
              Response.json({
                items: matches ? [Schema.encodeSync(TicketDetail)(server)] : [],
                nextCursor: null
              })
            )
          }
          return Promise.resolve(response())
        })
      )
      registry.mount(detail)
      registry.mount(preview)
      try {
        await vi.waitFor(() =>
          expect(registry.get(detail)).toMatchObject({
            _tag: "Success",
            value: ticket,
            waiting: false
          })
        )
        const status = Schema.decodeUnknownSync(TicketStatus)("in_progress")
        const patch = kind === "fields" ? { title: "After" } : { status }
        const mutation =
          kind === "fields"
            ? updateTicketAtom(key)
            : updateTicketStatusAtom(key)
        if (kind === "fields") {
          registry.set(updateTicketAtom(key), patch)
        } else {
          const query = { sort: { key: "id", dir: "asc" } } as const
          registry.set(updateTicketStatusAtom(key), {
            ticket,
            countKey: ticketsCountKey("org", "project", {}),
            status,
            sourceSectionKey: ticketsListKeyForStatus(
              "org",
              "project",
              query,
              ticket.status
            ),
            destSectionKey: ticketsListKeyForStatus(
              "org",
              "project",
              query,
              status
            )
          })
        }
        expect(registry.get(detail)).toMatchObject({
          _tag: "Success",
          value: { ...ticket, ...patch },
          waiting: true
        })
        await vi.waitFor(() =>
          expect(fetch).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ method: "PATCH" })
          )
        )
        server = { ...server, ...patch }
        finishUpdate(response())
        await vi.waitFor(() =>
          expect(registry.get(mutation).waiting).toBe(false)
        )
        expect(registry.get(preview)).toEqual({ input: {}, waiting: false })
        expect(registry.get(detail)).toMatchObject({
          value: server,
          waiting: false
        })

        server = {
          ...server,
          title: "Changed by another user",
          status: ticket.status
        }
        registry.set(updateTicketAtom(key), { priority: "high" })
        await vi.waitFor(() =>
          expect(
            vi
              .mocked(fetch)
              .mock.calls.filter(([, init]) => init?.method === "PATCH")
          ).toHaveLength(2)
        )
        server = { ...server, priority: "high" }
        finishUpdate(response())
        await vi.waitFor(() =>
          expect(registry.get(updateTicketAtom(key)).waiting).toBe(false)
        )
        expect(registry.get(detail)).toMatchObject({
          value: server,
          waiting: false
        })
        expect(registry.get(preview)).toEqual({ input: {}, waiting: false })
      } finally {
        registry.dispose()
      }
    }
  )

  it("rolls back a rejected detail edit", async () => {
    const registry = Registry.make()
    const key = ticketKey("org", "project", ticket.id)
    const detail = ticketAtom(key)
    let rejectUpdate: (error: Error) => void = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "PATCH"
          ? new Promise<Response>((_resolve, reject) => {
              rejectUpdate = reject
            })
          : Promise.resolve(
              Response.json(Schema.encodeSync(TicketDetail)(ticket))
            )
      )
    )
    registry.mount(detail)
    try {
      await vi.waitFor(() =>
        expect(Result.isSuccess(registry.get(detail))).toBe(true)
      )
      registry.set(updateTicketAtom(key), { title: "Rejected" })
      expect(registry.get(detail)).toMatchObject({
        value: { title: "Rejected" },
        waiting: true
      })
      await vi.waitFor(() =>
        expect(fetch).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ method: "PATCH" })
        )
      )
      rejectUpdate(new Error("offline"))
      await vi.waitFor(() =>
        expect(Result.isFailure(registry.get(updateTicketAtom(key)))).toBe(true)
      )
      expect(registry.get(detail)).toMatchObject({
        value: ticket,
        waiting: false
      })
      expect(registry.get(ticketUpdatePreviewAtom(key))).toEqual({
        input: {},
        waiting: false
      })
    } finally {
      registry.dispose()
    }
  })
})

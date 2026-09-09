import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TicketId, TicketStatus, TicketDetail } from "@projectproject/shared"
import {
  loadMoreTicketsAtom,
  quickCreateTicketAtom,
  ticketsSectionsAtom,
  ticketsSectionsKey,
  ticketsListKeyForStatus
} from "./tickets"

const ticket = {
  id: Schema.decodeSync(TicketId)("T-1"),
  title: "Before",
  status: Schema.decodeSync(TicketStatus)("todo"),
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
  createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  body: "Before"
} satisfies TicketDetail

const query = { sort: { key: "id", dir: "asc" } } as const
const sectionKey = ticketsListKeyForStatus(
  "org",
  "project",
  query,
  ticket.status
)
const key = ticketsSectionsKey("org", "project", query)
const encodeTicket = Schema.encodeSync(TicketDetail)

function snapshot(
  items: ReadonlyArray<TicketDetail>,
  nextCursor: string | null = null
) {
  return Response.json({
    counts: { total: items.length, byStatus: { todo: items.length } },
    sections: {
      todo: { items: items.map((item) => encodeTicket(item)), nextCursor }
    }
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("ticket sections", () => {
  it.each([true, false])(
    "preserves explicit creation identity or rolls it back (success: %s)",
    async (succeeds) => {
      let finish = (_response: Response) => {}
      const created = {
        ...ticket,
        id: Schema.decodeSync(TicketId)("T-2"),
        title: "Created"
      }
      let items = [ticket]
      vi.stubGlobal(
        "fetch",
        vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input)
          )
          if (init?.method === "POST")
            return new Promise<Response>((resolve) => {
              finish = resolve
            })
          if (url.pathname.endsWith("/sections"))
            return Promise.resolve(snapshot(items))
          return Promise.resolve(Response.json(encodeTicket(created)))
        })
      )
      const registry = AtomRegistry.make()
      const atom = ticketsSectionsAtom(key)
      registry.mount(atom)
      try {
        await vi.waitFor(() =>
          expect(registry.get(atom)).toMatchObject({
            _tag: "Success",
            waiting: false
          })
        )
        registry.set(quickCreateTicketAtom(sectionKey), {
          ticket: { title: created.title, status: ticket.status },
          viewerId: "user-1",
          projectPrefix: "T",
          clientId: "creation-1"
        })
        expect(registry.get(atom)).toMatchObject({
          waiting: true,
          value: {
            counts: { total: 2, byStatus: { todo: 2 } },
            sections: {
              todo: {
                items: [
                  {
                    key: "creation-1",
                    pending: true,
                    ticket: { title: "Created" }
                  },
                  { key: "T-1", pending: false }
                ]
              }
            }
          }
        })
        await vi.waitFor(() =>
          expect(fetch).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ method: "POST" })
          )
        )
        if (succeeds) items = [created, ticket]
        finish(
          succeeds
            ? Response.json(encodeTicket(created))
            : new Response("Rejected", { status: 500 })
        )
        await vi.waitFor(() =>
          expect(registry.get(quickCreateTicketAtom(sectionKey)).waiting).toBe(
            false
          )
        )
        const settled = registry.get(atom)
        expect(Result.isSuccess(settled)).toBe(true)
        if (!Result.isSuccess(settled))
          throw new Error("Snapshot did not settle")
        expect(settled.value.counts.total).toBe(succeeds ? 2 : 1)
        expect(
          settled.value.sections.todo.items.map(({ key, pending }) => ({
            key,
            pending
          }))
        ).toEqual(
          succeeds
            ? [
                { key: "creation-1", pending: false },
                { key: "T-1", pending: false }
              ]
            : [{ key: "T-1", pending: false }]
        )
      } finally {
        registry.dispose()
      }
    }
  )

  it("keeps appended pages scoped to their query", async () => {
    const second = { ...ticket, id: Schema.decodeSync(TicketId)("T-2") }
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        )
        if (url.pathname.endsWith("/sections"))
          return Promise.resolve(
            url.searchParams.has("q")
              ? snapshot([])
              : snapshot([ticket], "next-page")
          )
        return Promise.resolve(
          Response.json({ items: [encodeTicket(second)], nextCursor: null })
        )
      })
    )
    const registry = AtomRegistry.make()
    const atom = ticketsSectionsAtom(key)
    registry.mount(atom)
    try {
      await vi.waitFor(() =>
        expect(registry.get(atom)).toMatchObject({
          _tag: "Success",
          waiting: false
        })
      )
      registry.set(loadMoreTicketsAtom(sectionKey), undefined)
      await vi.waitFor(() =>
        expect(registry.get(atom)).toMatchObject({
          value: {
            sections: {
              todo: {
                items: [{ ticket: { id: "T-1" } }, { ticket: { id: "T-2" } }],
                nextCursor: null
              }
            }
          }
        })
      )
      const searched = ticketsSectionsAtom(
        ticketsSectionsKey("org", "project", { ...query, q: "missing" })
      )
      registry.mount(searched)
      await vi.waitFor(() =>
        expect(registry.get(searched)).toMatchObject({
          value: {
            counts: { total: 0 },
            sections: { todo: { items: [], nextCursor: null } }
          }
        })
      )
      expect(registry.get(atom)).toMatchObject({
        value: {
          sections: { todo: { items: [{ key: "T-1" }, { key: "T-2" }] } }
        }
      })
    } finally {
      registry.dispose()
    }
  })
})

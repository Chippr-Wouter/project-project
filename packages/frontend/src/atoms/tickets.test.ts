import * as Atom from "effect/unstable/reactivity/Atom"
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import {
  TicketId,
  TicketStatus,
  TicketDetail,
  TagName
} from "@projectproject/shared"
import {
  applyOptimisticTicketPreview,
  applyOptimisticTicketUpdate,
  hydrateTicketAtom,
  ticketAtom,
  ticketKey,
  ticketsCountKey,
  ticketsCountAtom,
  ticketsSectionsAtom,
  ticketsSectionsKey,
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
  createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const registry = AtomRegistry.make()
    const key = ticketKey("org", "project", ticket.id)
    const preview = ticketUpdatePreviewAtom(key)
    const dispose = registry.mount(preview)

    registry.set(updateTicketAtom(key), { priority: "high" })

    expect(registry.get(preview)).toEqual({
      input: { priority: "high" },
      waiting: true
    })
    dispose()
    registry.dispose()
  })

  it("publishes status updates through the same optimistic preview", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const registry = AtomRegistry.make()
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
    registry.dispose()
  })

  it("publishes a created ticket into the detail atom synchronously", () => {
    const scheduled: Array<() => void> = []
    const registry = AtomRegistry.make({
      scheduleTask: (task: () => void) => {
        scheduled.push(task)
        return () => {}
      },
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
      const registry = AtomRegistry.make()
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
          if (url.pathname.endsWith("/sections")) {
            return Promise.resolve(
              Response.json({
                counts: { total: 1, byStatus: { [server.status]: 1 } },
                sections: {
                  [server.status]: {
                    items: [Schema.encodeSync(TicketDetail)(server)],
                    nextCursor: null
                  }
                }
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
    const registry = AtomRegistry.make()
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

  it("resends an interrupted field when a second edit supersedes it", async () => {
    const registry = AtomRegistry.make()
    const key = ticketKey("org", "project", ticket.id)
    const detail = ticketAtom(key)
    const payloads: Array<Record<string, unknown>> = []
    let server: TicketDetail = ticket
    let finishUpdate: (response: Response) => void = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          payloads.push(
            JSON.parse(
              new TextDecoder().decode(init.body as Uint8Array)
            ) as Record<string, unknown>
          )
          return new Promise<Response>((resolve) => {
            finishUpdate = resolve
          })
        }
        return Promise.resolve(
          Response.json(Schema.encodeSync(TicketDetail)(server))
        )
      })
    )
    registry.mount(detail)
    try {
      await vi.waitFor(() =>
        expect(Result.isSuccess(registry.get(detail))).toBe(true)
      )

      registry.set(updateTicketAtom(key), { body: "Long description" })
      await vi.waitFor(() => expect(payloads).toHaveLength(1))

      registry.set(updateTicketAtom(key), { priority: "high" })
      await vi.waitFor(() => expect(payloads).toHaveLength(2))

      expect(payloads[1]).toMatchObject({
        body: "Long description",
        priority: "high"
      })

      server = { ...ticket, body: "Long description", priority: "high" }
      finishUpdate(Response.json(Schema.encodeSync(TicketDetail)(server)))
      await vi.waitFor(() =>
        expect(registry.get(detail)).toMatchObject({
          value: { body: "Long description", priority: "high" },
          waiting: false
        })
      )
    } finally {
      registry.dispose()
    }
  })
})

it("refreshes one edited detail and its project lists without refetching unrelated tickets", async () => {
  const registry = AtomRegistry.make()
  let server = ticket
  const requests: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`)
      if (init?.method === "PATCH") server = { ...server, title: "Updated" }
      if (url.pathname.endsWith("/sections"))
        return Promise.resolve(
          Response.json({
            counts: { total: 1, byStatus: { [server.status]: 1 } },
            sections: {
              [server.status]: {
                items: [Schema.encodeSync(TicketDetail)(server)],
                nextCursor: null
              }
            }
          })
        )
      const id = url.pathname.endsWith("T-2")
        ? Schema.decodeUnknownSync(TicketId)("T-2")
        : ticket.id
      return Promise.resolve(
        Response.json(Schema.encodeSync(TicketDetail)({ ...server, id }))
      )
    })
  )
  const key = ticketKey("org", "project", ticket.id)
  const atoms: ReadonlyArray<Atom.Atom<unknown>> = [
    ticketAtom(key),
    ticketAtom(
      ticketKey("org", "project", Schema.decodeUnknownSync(TicketId)("T-2"))
    ),
    ticketAtom(ticketKey("org", "other", ticket.id)),
    ticketsSectionsAtom(
      ticketsSectionsKey("org", "project", { sort: { key: "id", dir: "asc" } })
    ),
    ticketsSectionsAtom(
      ticketsSectionsKey("org", "other", { sort: { key: "id", dir: "asc" } })
    )
  ]
  try {
    for (const atom of atoms) registry.mount(atom)
    await vi.waitFor(() => {
      for (const atom of atoms)
        expect(registry.get(atom)).toMatchObject({
          _tag: "Success",
          waiting: false
        })
    })
    requests.length = 0
    registry.set(updateTicketAtom(key), { title: "Updated" })
    await vi.waitFor(() =>
      expect(registry.get(updateTicketAtom(key))).toMatchObject({
        _tag: "Success",
        waiting: false
      })
    )
    await vi.waitFor(() =>
      expect(
        requests.filter((request) =>
          request.endsWith("/project/tickets/sections")
        )
      ).toHaveLength(1)
    )
    expect(
      requests.filter((request) => request.startsWith("GET"))
    ).toHaveLength(2)
    expect(
      requests.some(
        (request) => request.includes("/other/") || request.endsWith("T-2")
      )
    ).toBe(false)
    expect(registry.get(ticketAtom(key))).toMatchObject({
      value: { title: "Updated" },
      waiting: false
    })
  } finally {
    registry.dispose()
  }
})

it.each(["title", "body"] as const)(
  "bounds %s edit reads while retaining search invalidation",
  async (field) => {
    const registry = AtomRegistry.make()
    const requests: string[] = []
    let current: TicketDetail = ticket
    const encode = Schema.encodeSync(TicketDetail)
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          "http://localhost"
        )
        if (init?.method === "PATCH") {
          current = { ...ticket, [field]: "After" }
          return Response.json(encode(current))
        }
        requests.push(url.pathname + url.search)
        if (url.pathname.endsWith("/count"))
          return Response.json({ total: 1, byStatus: { todo: 1 } })
        if (url.pathname.endsWith("/sections")) {
          const row = url.searchParams.has("tags")
            ? { ...ticket, id: Schema.decodeSync(TicketId)("T-2") }
            : current
          return Response.json({
            counts: { total: 1, byStatus: { todo: 1 } },
            sections: { todo: { items: [encode(row)], nextCursor: null } }
          })
        }
        return Response.json(encode(current))
      }
    )
    const query = { sort: { key: "id", dir: "asc" } } as const
    const detail = ticketAtom(ticketKey("org", "project", ticket.id))
    const own = ticketsSectionsAtom(ticketsSectionsKey("org", "project", query))
    const unrelated = ticketsSectionsAtom(
      ticketsSectionsKey("org", "project", {
        ...query,
        filter: { tags: [Schema.decodeSync(TagName)("other")] }
      })
    )
    const counts = ticketsCountAtom(ticketsCountKey("org", "project", {}))
    const searchedCounts = ticketsCountAtom(
      ticketsCountKey("org", "project", { q: "After" })
    )
    const update = updateTicketAtom(ticketKey("org", "project", ticket.id))
    registry.mount(detail)
    registry.mount(own)
    registry.mount(unrelated)
    registry.mount(counts)
    registry.mount(searchedCounts)
    registry.mount(update)
    try {
      await vi.waitFor(() => {
        expect(registry.get(detail)).toMatchObject({ _tag: "Success" })
        expect(registry.get(own)).toMatchObject({ _tag: "Success" })
        expect(registry.get(unrelated)).toMatchObject({ _tag: "Success" })
        expect(registry.get(counts)).toMatchObject({ _tag: "Success" })
        expect(registry.get(searchedCounts)).toMatchObject({ _tag: "Success" })
      })
      requests.length = 0
      registry.set(update, { [field]: "After" })
      await vi.waitFor(() =>
        expect(registry.get(update)).toMatchObject({
          _tag: "Success",
          waiting: false
        })
      )
      expect(requests.filter((path) => path.includes("tags="))).toEqual([])
      expect(requests.filter((path) => path.endsWith("/count"))).toEqual([])
      expect(
        requests.filter((path) => path.includes("/sections"))
      ).toHaveLength(field === "title" ? 1 : 0)
      expect(
        requests.filter((path) => path.includes("/count?q=After"))
      ).toHaveLength(field === "title" ? 1 : 0)
      expect(
        requests.filter((path) => path.endsWith("/tickets/T-1"))
      ).toHaveLength(1)
    } finally {
      registry.dispose()
    }
  }
)

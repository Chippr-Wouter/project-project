import type * as Atom from "effect/unstable/reactivity/Atom"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import { GroupId, TicketId } from "@projectproject/shared"
import { afterEach, expect, it, vi } from "vitest"
import {
  addTicketsToSprintAtom,
  removeTicketsFromSprintAtom,
  placeTicketAtom,
  sprintAtom,
  sprintsListAtom
} from "./sprints"
import { ticketsInSprintAtom } from "./tickets"

afterEach(() => vi.unstubAllGlobals())

it.each(["add", "remove", "reorder", "rollback"] as const)(
  "reconciles %s once per affected resource",
  async (operation) => {
    const registry = Registry.make()
    const requests: string[] = []
    const id = Schema.decodeSync(TicketId)("T-1")
    const groupId = Schema.decodeSync(GroupId)("G-1")
    const key = "org/project"
    const targetKey = key + "/G-1"
    let group = {
      id: "G-1",
      name: "Sprint",
      kind: "sprint",
      tickets: operation === "add" ? ([] as string[]) : ["T-2", "T-1"],
      color: "#94a3b8",
      startsAt: null,
      endsAt: null,
      completedAt: null,
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      body: ""
    }
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(
          input instanceof Request ? input.url : String(input),
          "http://localhost"
        ).pathname
        if (init?.method === "PATCH" || init?.method === "PUT") {
          if (operation === "rollback")
            return Response.json({ _tag: "Forbidden" }, { status: 403 })
          group = {
            ...group,
            tickets:
              operation === "remove"
                ? ["T-2"]
                : operation === "reorder"
                  ? ["T-1", "T-2"]
                  : ["T-1"]
          }
          return Response.json(
            operation === "reorder" ? group : { target: group, evicted: [] }
          )
        }
        requests.push(path)
        if (path.endsWith("/groups")) return Response.json([group])
        if (path.endsWith("/tickets")) return Response.json([])
        return Response.json(group)
      }
    )
    const list = sprintsListAtom(key)
    const detail = sprintAtom(targetKey)
    const tickets = ticketsInSprintAtom(targetKey)
    registry.mount(list)
    registry.mount(detail)
    registry.mount(tickets)
    try {
      await vi.waitFor(() => {
        expect(registry.get(list)).toMatchObject({ _tag: "Success" })
        expect(registry.get(detail)).toMatchObject({ _tag: "Success" })
        expect(registry.get(tickets)).toMatchObject({ _tag: "Success" })
      })
      requests.length = 0
      const mutation: Atom.Atom<unknown> =
        operation === "reorder" || operation === "rollback"
          ? placeTicketAtom(targetKey)
          : operation === "add"
            ? addTicketsToSprintAtom(key)
            : removeTicketsFromSprintAtom(key)
      registry.mount(mutation)
      if (operation === "reorder" || operation === "rollback")
        registry.set(placeTicketAtom(targetKey), { ticketId: id, after: null })
      else if (operation === "add")
        registry.set(addTicketsToSprintAtom(key), { groupId, ticketIds: [id] })
      else
        registry.set(removeTicketsFromSprintAtom(key), {
          groupId,
          ticketIds: [id]
        })
      if (operation === "rollback") {
        expect(registry.get(list)).toMatchObject({
          value: [{ tickets: ["T-1", "T-2"] }],
          waiting: true
        })
        await vi.waitFor(() =>
          expect(registry.get(mutation)).toMatchObject({
            _tag: "Failure",
            waiting: false
          })
        )
        expect(registry.get(list)).toMatchObject({
          value: [{ tickets: ["T-2", "T-1"] }],
          waiting: false
        })
        expect(requests).toEqual([])
        return
      }
      await vi.waitFor(() =>
        expect(registry.get(mutation)).toMatchObject({
          _tag: "Success",
          waiting: false
        })
      )
      await vi.waitFor(() =>
        expect(requests.toSorted()).toEqual([
          "/api/orgs/org/projects/project/groups",
          "/api/orgs/org/projects/project/groups/G-1",
          "/api/orgs/org/projects/project/groups/G-1/tickets"
        ])
      )
    } finally {
      registry.dispose()
    }
  }
)

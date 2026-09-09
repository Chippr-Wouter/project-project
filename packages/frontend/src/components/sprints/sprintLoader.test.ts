import * as Atom from "effect/unstable/reactivity/Atom"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, it, vi } from "vitest"

const requests = vi.hoisted(() => ({ started: [] as string[] }))

vi.mock("@/components/sprints/SprintDetail", () => ({
  SprintDetail: () => null
}))
vi.mock("@/atoms/sprints", async () => {
  const atom = await import("effect/unstable/reactivity/Atom")
  const effect = await import("effect/Effect")
  return {
    projectKey: (org: string, slug: string) => `${org}/${slug}`,
    sprintKey: (org: string, slug: string, id: string) =>
      `${org}/${slug}/${id}`,
    sprintAtom: atom.family(() =>
      atom.make(
        effect.gen(function* () {
          requests.started.push("detail")
          yield* effect.sleep("100 millis")
          requests.started.push("detail:done")
        })
      )
    ),
    sprintsListAtom: atom.family(() => atom.make(effect.succeed([])))
  }
})
vi.mock("@/atoms/projectStatuses", async () => {
  const atom = await import("effect/unstable/reactivity/Atom")
  const effect = await import("effect/Effect")
  return {
    projectStatusesAtom: atom.family(() =>
      atom.make(effect.succeed([{ slug: "todo" }, { slug: "done" }]))
    )
  }
})
vi.mock("@/atoms/tickets", async () => {
  const actual =
    await vi.importActual<typeof import("@/atoms/tickets")>("@/atoms/tickets")
  return {
    ...actual,
    ticketsCountAtom: Atom.family(() =>
      Atom.make(
        Effect.gen(function* () {
          requests.started.push("counts")
          yield* Effect.sleep("100 millis")
          requests.started.push("counts:done")
          return { total: 2, byStatus: { todo: 1, done: 1 } }
        })
      )
    ),
    ticketsListAtom: Atom.family((key: string) =>
      Atom.make(
        Effect.sync(() => {
          requests.started.push(`rows:${key}`)
          return { items: [], nextCursor: null }
        })
      )
    ),
    ticketsInSprintAtom: Atom.family((key: string) =>
      Atom.make(
        Effect.sync(() => {
          requests.started.push(`board:${key}`)
          return []
        })
      )
    )
  }
})

import { Route } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/sprints/$groupId"
import { ticketsListKeyForStatus } from "@/atoms/tickets"
import { StatusSlug, ticketListQueryFromSearch } from "@projectproject/shared"

const registries: Registry.AtomRegistry[] = []

function load(deps: {
  view: "list" | "board" | "description"
  status?: string[]
}) {
  const registry = Registry.make()
  registries.push(registry)
  const loader = Route.options.loader
  if (typeof loader !== "function") throw new Error("Missing sprint loader")
  return loader({
    context: { registry },
    params: { orgSlug: "test", slug: "project", groupId: "G-1" },
    deps,
    abortController: new AbortController()
  } as Parameters<typeof loader>[0])
}

afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose()
  requests.started.length = 0
})

describe("sprint route loading", () => {
  it("starts scoped rows before detail and counts finish", async () => {
    await load({ view: "list" })
    const query = ticketListQueryFromSearch({ groupId: ["G-1"] })
    for (const status of ["todo", "done"] as const) {
      const row = `rows:${ticketsListKeyForStatus("test", "project", query, Schema.decodeSync(StatusSlug)(status))}`
      expect(requests.started).toContain(row)
      expect(requests.started.indexOf(row)).toBeLessThan(
        requests.started.indexOf("detail:done")
      )
      expect(requests.started.indexOf(row)).toBeLessThan(
        requests.started.indexOf("counts:done")
      )
    }
    expect(
      requests.started.some((request) => request.startsWith("board:"))
    ).toBe(false)
  })

  it("only loads the requested status", async () => {
    await load({ view: "list", status: ["todo"] })
    expect(
      requests.started.filter((request) => request.startsWith("rows:"))
    ).toHaveLength(1)
  })

  it("loads board tickets without list requests", async () => {
    await load({ view: "board" })
    expect(requests.started).toContain("board:test/project/G-1")
    expect(requests.started).not.toContain("counts")
    expect(
      requests.started.some((request) => request.startsWith("rows:"))
    ).toBe(false)
  })

  it("skips ticket requests for the description", async () => {
    await load({ view: "description" })
    expect(requests.started).toEqual(["detail", "detail:done"])
  })
})

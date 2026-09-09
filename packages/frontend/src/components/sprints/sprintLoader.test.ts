import * as Atom from "effect/unstable/reactivity/Atom"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Effect from "effect/Effect"
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
    ticketsSectionsAtom: Atom.family((key: string) =>
      Atom.make(
        Effect.sync(() => {
          requests.started.push(`sections:${key}`)
          return { counts: { total: 0, byStatus: {} }, sections: {} }
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
import { ticketsSectionsKey } from "@/atoms/tickets"
import { ticketListQueryFromSearch } from "@projectproject/shared"

const registries: Registry.AtomRegistry[] = []

function load(deps: {
  view: "list" | "board" | "description"
  status?: string[]
  q?: string
  groupId?: string[]
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
  it.each(["needle", undefined])(
    "preloads the shared sections query within the sprint when searching or clearing (%s)",
    async (q) => {
      await load({ view: "list", q, groupId: ["G-2"] })
      const query = ticketListQueryFromSearch({ q, groupId: ["G-1"] })
      const request = `sections:${ticketsSectionsKey("test", "project", query)}`
      expect(requests.started).toContain(request)
      expect(requests.started.indexOf(request)).toBeLessThan(
        requests.started.indexOf("detail:done")
      )
      expect(
        requests.started.filter((item) => item.startsWith("sections:"))
      ).toEqual([request])
      expect(requests.started.some((item) => item.startsWith("board:"))).toBe(
        false
      )
    }
  )

  it("uses the same sections cache for a status-filtered sprint search", async () => {
    await load({ view: "list", status: ["todo"], q: "needle" })
    const query = ticketListQueryFromSearch({
      q: "needle",
      status: ["todo"],
      groupId: ["G-1"]
    })
    expect(
      requests.started.filter((item) => item.startsWith("sections:"))
    ).toEqual([`sections:${ticketsSectionsKey("test", "project", query)}`])
  })

  it("loads board tickets without list or count requests", async () => {
    await load({ view: "board" })
    expect(requests.started).toContain("board:test/project/G-1")
    expect(
      requests.started.some((request) => request.startsWith("sections:"))
    ).toBe(false)
  })

  it("skips ticket requests for the description", async () => {
    await load({ view: "description" })
    expect(requests.started).toEqual(["detail", "detail:done"])
  })
})

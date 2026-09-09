import { RegistryContext } from "@effect/atom-react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider
} from "@tanstack/react-router"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import { TicketDetail, ticketListQueryFromSearch } from "@projectproject/shared"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { Route as BacklogRoute } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/index"
import { Route as SprintRoute } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/sprints/$groupId"
import { Route as SprintIndexRoute } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/sprints/index"
import { Route as TicketRoute } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/tickets/$id"
import { Row } from "./TicketList/Row"
import { SprintBoardCard } from "./sprints/SprintBoardCard"

vi.mock("@/routes/_authed/orgs/$orgSlug/projects/$slug/-context", () => ({
  useProject: () => ({ github: null })
}))

let registry: Registry.AtomRegistry
let requests: URL[]
const params = { orgSlug: "org", slug: "project", groupId: "G-1", id: "T-1" }

function load<A, R>(
  loader: ((args: A) => R) | object | undefined,
  args: Partial<A>
) {
  if (typeof loader !== "function") throw new Error("Missing loader")
  return loader(args as A)
}

beforeEach(() => {
  registry = Registry.make()
  requests = []
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    requests.push(
      new URL(
        input instanceof Request ? input.url : String(input),
        "http://localhost"
      )
    )
    return new Promise<Response>(() => {})
  })
})

afterEach(() => {
  cleanup()
  registry.dispose()
  localStorage.clear()
  vi.unstubAllGlobals()
})

it("starts backlog sections alongside metadata without waiting, even with collapsed sections", async () => {
  localStorage.setItem(
    "projectproject:ticket-list-collapsed:org/project",
    JSON.stringify(["todo", "review"])
  )
  const query = ticketListQueryFromSearch({
    q: "search",
    status: ["review"],
    sort: "title:desc"
  })
  expect(
    load(BacklogRoute.options.loader, {
      context: { registry },
      params,
      deps: query
    })
  ).toBeUndefined()
  await waitFor(() => expect(requests).toHaveLength(4))
  const sections = requests.find((url) => url.pathname.endsWith("/sections"))
  expect(sections?.searchParams.get("q")).toBe("search")
  expect(sections?.searchParams.has("status")).toBe(false)
  expect(sections?.searchParams.get("sort")).toBe("title:desc")
  expect(requests.map((url) => url.pathname)).toContain(
    "/api/orgs/org/projects/project/statuses"
  )
})

it.each(["board", "list", "description"] as const)(
  "starts only the %s view's ticket read without awaiting responses",
  async (view) => {
    expect(
      load(SprintRoute.options.loader, {
        context: { registry },
        params,
        deps: { view, q: "needle", status: ["review"], groupId: ["G-2"] }
      })
    ).toMatchObject({ crumb: { groupId: "G-1" } })
    await waitFor(() =>
      expect(requests).toHaveLength(view === "description" ? 3 : 4)
    )
    const ticketRequests = requests.filter((url) =>
      url.pathname.includes("/tickets")
    )
    expect(ticketRequests).toHaveLength(view === "description" ? 0 : 1)
    if (view === "list") {
      expect(ticketRequests[0].pathname).toMatch(/\/sections$/)
      expect(ticketRequests[0].searchParams.get("q")).toBe("needle")
      expect(ticketRequests[0].searchParams.has("status")).toBe(false)
    }
    if (view === "list")
      expect(ticketRequests[0].searchParams.get("groupId")).toBe("G-1")
    if (view === "board")
      expect(ticketRequests[0].pathname).toMatch(/\/groups\/G-1\/tickets$/)
  }
)

it("starts the sprint index target's data as soon as the list resolves", async () => {
  let resolveList: (response: Response) => void = vi.fn()
  const list = new Promise<Response>((resolve) => {
    resolveList = resolve
  })
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      "http://localhost"
    )
    requests.push(url)
    return url.pathname.endsWith("/groups")
      ? list
      : new Promise<Response>(() => {})
  })
  const loaded = load(SprintIndexRoute.options.loader, {
    context: { registry },
    params,
    abortController: new AbortController()
  })
  const redirected = expect(loaded).rejects.toMatchObject({
    options: { params: { groupId: "G-1" } }
  })
  await waitFor(() => expect(requests).toHaveLength(1))
  resolveList(
    Response.json([
      {
        id: "G-1",
        name: "Sprint",
        kind: "sprint",
        tickets: [],
        color: "#94a3b8",
        startsAt: null,
        endsAt: null,
        completedAt: "2026-01-01T00:00:00.000Z",
        createdBy: "user-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ])
  )
  await redirected
  await waitFor(() => expect(requests).toHaveLength(4))
  expect(requests.map((url) => url.pathname)).toContain(
    "/api/orgs/org/projects/project/groups/G-1"
  )
})

const ticket = Schema.decodeSync(TicketDetail)({
  id: "T-1",
  title: "Hover target",
  status: "todo",
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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  body: ""
})

it.each(["row", "card"] as const)(
  "hovering a ticket %s starts shared ticket and comment reads",
  async (kind) => {
    const root = createRootRoute()
    const home = createRoute({
      getParentRoute: () => root,
      path: "/",
      component: () =>
        kind === "card" ? (
          <SprintBoardCard
            orgSlug="org"
            slug="project"
            sprintTicketsKey="org/project/G-1"
            ticket={ticket}
            members={[]}
          />
        ) : (
          <Row
            orgSlug="org"
            slug="project"
            ticket={ticket}
            query={ticketListQueryFromSearch({})}
            members={[]}
            showSprintCol={false}
            showExtraActionsCol={false}
            sprintMembership={null}
            previewOpen={false}
            onPreviewPointerEnter={() => {}}
            onPreviewOpenChange={() => {}}
          />
        )
    })
    const detail = createRoute({
      getParentRoute: () => root,
      path: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      loader: () =>
        load(TicketRoute.options.loader, { context: { registry }, params }),
      component: () => null
    })
    const router = createRouter({
      routeTree: root.addChildren([home, detail]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
      defaultPreloadDelay: 0
    })
    await router.load()
    render(
      <RegistryContext.Provider value={registry}>
        <RouterProvider router={router} />
      </RegistryContext.Provider>
    )
    const link = await screen.findByRole("link", { name: "Hover target" })
    expect(requests.some((url) => url.pathname.endsWith("/tickets/T-1"))).toBe(
      false
    )
    fireEvent.mouseEnter(link)
    await waitFor(() => {
      expect(
        requests.filter((url) => url.pathname.endsWith("/tickets/T-1"))
      ).toHaveLength(1)
      expect(
        requests.filter((url) => url.pathname.endsWith("/comments"))
      ).toHaveLength(1)
    })
    await act(async () => {
      await router.preloadRoute({
        to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
        params
      })
    })
    expect(
      requests.filter((url) => url.pathname.endsWith("/tickets/T-1"))
    ).toHaveLength(1)
  }
)

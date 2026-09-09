import { RegistryContext } from "@effect/atom-react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Schema from "effect/Schema"
import { TicketDetail } from "@projectproject/shared"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RunningTimerIndicator } from "./time/RunningTimerIndicator"
import { TicketTimeSection } from "./time/TicketTimePanel"
import { TagEditor } from "./TagEditor"
import { TagRenamesProvider } from "./TagRenamesProvider"

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useLocation: () => ({ pathname: "/orgs/org/projects/project/tickets/T-1" })
}))
vi.mock("@/lib/projectRole", () => ({
  useProjectRole: () => ({ isOwner: false, isAdmin: false })
}))
vi.mock("@/components/ErrorPage", () => ({
  ErrorPage: () => null
}))

const ticket = Schema.decodeSync(TicketDetail)({
  id: "T-1",
  title: "Test ticket",
  status: "todo",
  type: "feat",
  priority: "med",
  tags: ["test"],
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

let registry: Registry.AtomRegistry

beforeEach(() => {
  registry = Registry.make()
})

afterEach(() => {
  cleanup()
  registry.dispose()
  vi.unstubAllGlobals()
})

it.each(["not_connected", "active", "broken", "failed"] as const)(
  "gates timer and ticket reads while status is pending, then handles %s",
  async (status) => {
    const requests: string[] = []
    let resolveStatus = (_response: Response) => {}
    const statusResponse = new Promise<Response>((resolve) => {
      resolveStatus = resolve
    })
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        "http://localhost"
      ).pathname
      requests.push(path)
      if (path.endsWith("/timer/current")) return Response.json(null)
      if (path.endsWith("/integrations/everhour")) return statusResponse
      return new Promise<Response>(() => {})
    })
    render(
      <RegistryContext.Provider value={registry}>
        <RunningTimerIndicator orgSlug="org" />
        <TicketTimeSection orgSlug="org" slug="project" ticket={ticket} />
      </RegistryContext.Provider>
    )
    const initialRequests = [
      "/api/orgs/org/everhour/timer/current",
      "/api/orgs/org/projects/project/integrations/everhour"
    ]
    await waitFor(() => expect(requests.toSorted()).toEqual(initialRequests), {
      timeout: 5000
    })
    await act(async () => {
      resolveStatus(
        status === "failed"
          ? new Response(null, { status: 500 })
          : Response.json({
              status,
              everhourProjectId:
                status === "not_connected" ? null : "project-1",
              everhourProjectName: null,
              lastSyncedAt: null,
              lastSyncStatus: null,
              lastSyncError: null,
              needsSync: false
            })
      )
    })
    if (status === "active" || status === "broken") {
      await waitFor(
        () =>
          expect(requests.toSorted()).toEqual(
            [
              ...initialRequests,
              "/api/integrations/everhour/profile",
              "/api/orgs/org/projects/project/groups",
              "/api/orgs/org/projects/project/tickets/T-1/everhour/time",
              "/api/orgs/org/projects/project/tickets/T-1/everhour/work-types"
            ].toSorted()
          ),
        { timeout: 5000 }
      )
    } else {
      expect(requests.toSorted()).toEqual(initialRequests)
    }
  }
)

it("loads tag usage counts when management opens", async () => {
  const requests: string[] = []
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      "http://localhost"
    ).pathname
    requests.push(path)
    if (path.endsWith("/usage-counts")) return Response.json({ test: 7 })
    if (path.endsWith("/tags"))
      return Response.json([
        {
          name: "test",
          color: "#94a3b8",
          createdBy: "user-1",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ])
    throw new Error("Unexpected request: " + path)
  })
  render(
    <RegistryContext.Provider value={registry}>
      <TagRenamesProvider>
        <TagEditor orgSlug="org" slug="project" ticket={ticket} canManageTags />
      </TagRenamesProvider>
    </RegistryContext.Provider>
  )
  const edit = await screen.findByRole("button", { name: "Edit tag test" })
  expect(requests).toEqual(["/api/orgs/org/projects/project/tags"])
  fireEvent.click(edit)
  await screen.findByText("Applied to 7 tickets")
  expect(requests).toEqual([
    "/api/orgs/org/projects/project/tags",
    "/api/orgs/org/projects/project/tags/usage-counts"
  ])
})

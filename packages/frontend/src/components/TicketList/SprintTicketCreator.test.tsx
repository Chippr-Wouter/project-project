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
import { GroupId } from "@projectproject/shared"
import { afterEach, expect, it, vi } from "vitest"
import { SprintTicketCreator } from "./SprintTicketCreator"

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each(["focus", "hover"] as const)(
  "activates on %s, debounces typing, and ignores a late earlier response",
  async (intent) => {
    const registry = Registry.make()
    const searches = new Map<string, (response: Response) => void>()
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        "http://localhost"
      )
      return new Promise<Response>((resolve) => {
        if (url.pathname.endsWith("/search"))
          searches.set(url.searchParams.get("q") ?? "", resolve)
      })
    })
    try {
      render(
        <RegistryContext.Provider value={registry}>
          <SprintTicketCreator
            orgSlug="org"
            slug="project"
            groupId={Schema.decodeSync(GroupId)("G-1")}
            excludeIds={new Set()}
          />
        </RegistryContext.Provider>
      )
      const input = screen.getByRole("textbox")
      expect(searches.size).toBe(0)
      if (intent === "hover") fireEvent.pointerEnter(input)
      else fireEvent.focus(input)
      await waitFor(() => expect([...searches.keys()]).toEqual([""]))
      if (intent === "hover") fireEvent.focus(input)
      fireEvent.change(input, { target: { value: "ear" } })
      fireEvent.change(input, { target: { value: "early" } })
      expect([...searches.keys()]).toEqual([""])
      await waitFor(() => expect([...searches.keys()]).toEqual(["", "early"]))
      fireEvent.change(input, { target: { value: "latest" } })
      await waitFor(() =>
        expect([...searches.keys()]).toEqual(["", "early", "latest"])
      )
      const ticket = (id: string, title: string) => ({
        id,
        title,
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
        updatedAt: "2026-01-01T00:00:00.000Z"
      })
      await act(async () =>
        searches.get("latest")?.(
          Response.json([ticket("T-2", "Latest result")])
        )
      )
      await screen.findByText("Latest result")
      await act(async () =>
        searches.get("early")?.(Response.json([ticket("T-1", "Early result")]))
      )
      expect(screen.queryByText("Early result")).toBeNull()
      expect(screen.getByText("Latest result")).toBeTruthy()
    } finally {
      cleanup()
      registry.dispose()
    }
  }
)

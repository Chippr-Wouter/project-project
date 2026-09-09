import { RegistryContext } from "@effect/atom-react"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { m } from "@/paraglide/messages"
import { Route as OrgRoute } from "@/routes/_authed/orgs/$orgSlug/route"
import { Route as MembersRoute } from "@/routes/_authed/orgs/$orgSlug/settings/members"
import { Route as AttachmentsRoute } from "@/routes/_authed/orgs/$orgSlug/settings/attachments"

const { getFullOrganization } = vi.hoisted(() => ({
  getFullOrganization: vi.fn(() => new Promise<never>(() => {}))
}))

vi.mock("@/services/AuthClient", () => ({
  authClient: { organization: { getFullOrganization } }
}))

let registry: Registry.AtomRegistry
let requests: string[]
let finishOrg: (response: Response) => void

beforeEach(() => {
  registry = Registry.make()
  requests = []
  getFullOrganization.mockClear()
  const org = new Promise<Response>((resolve) => {
    finishOrg = resolve
  })
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      "http://localhost"
    ).pathname
    requests.push(path)
    return path === "/api/orgs/test" ? org : new Promise<Response>(() => {})
  })
  vi.spyOn(AttachmentsRoute, "useParams").mockReturnValue({ orgSlug: "test" })
})

afterEach(() => {
  cleanup()
  registry.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function load<A, R>(
  loader: ((args: A) => R) | object | undefined,
  args: Partial<A>
) {
  if (typeof loader !== "function") throw new Error("Missing loader")
  return loader(args as A)
}

it("starts members while the parent org loader is still waiting", async () => {
  const controller = new AbortController()
  const parent = load(OrgRoute.options.loader, {
    context: { registry },
    params: { orgSlug: "test" },
    abortController: controller
  })
  load(MembersRoute.options.loader, {
    context: { registry },
    params: { orgSlug: "test" }
  })
  await waitFor(() =>
    expect(getFullOrganization).toHaveBeenCalledWith({
      query: { organizationSlug: "test" }
    })
  )
  expect(requests).toEqual(
    expect.arrayContaining(["/api/orgs/test", "/api/orgs/test/projects"])
  )
  controller.abort()
  await parent
})

it.each(["member", "admin", "owner"])(
  "gates attachment inventory for %s while storage is pending",
  async (role) => {
    const Component = AttachmentsRoute.options.component
    if (!Component) throw new Error("Missing attachments component")
    render(
      <RegistryContext.Provider value={registry}>
        <Component />
      </RegistryContext.Provider>
    )
    await waitFor(() => expect(requests).toEqual(["/api/orgs/test"]))
    await act(async () =>
      finishOrg(
        Response.json({
          id: "org-1",
          slug: "test",
          name: "Test",
          role,
          createdAt: "2026-01-01T00:00:00.000Z",
          deletedAt: null,
          purgeAt: null
        })
      )
    )
    if (role === "member") {
      expect(
        await screen.findByText(m.attachments_error_forbidden())
      ).toBeTruthy()
      expect(requests).toEqual(["/api/orgs/test"])
    } else {
      await waitFor(() =>
        expect(requests).toEqual(
          expect.arrayContaining([
            "/api/orgs/test/attachments",
            "/api/orgs/test/attachments/summary",
            "/api/orgs/test/projects",
            "/api/orgs/test/storage"
          ])
        )
      )
      expect(requests).toHaveLength(5)
    }
  }
)

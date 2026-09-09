import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  orgDetailAtom,
  renameOrgAtom,
  restoreOrgAtom,
  softDeleteOrgAtom
} from "@/atoms/orgs"
import { Route } from "@/routes/_authed/orgs/$orgSlug/route"

const updateOrganization = vi.hoisted(() => vi.fn())

vi.mock("@/services/AuthClient", () => ({
  authClient: { organization: { update: updateOrganization } }
}))

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Outlet: () => <OrgConsumer />
}))
vi.mock("@/components/DeletedOrgPage", () => ({
  DeletedOrgPage: () => <div>Deleted organization</div>
}))
vi.mock("@/components/NotFoundPage", () => ({
  NotFoundPage: () => <div>Organization not found</div>
}))
vi.mock("@/components/ErrorPage", () => ({
  ErrorPage: ({ reset }: { reset: () => void }) => (
    <button onClick={reset}>Retry organization</button>
  )
}))
vi.mock("@/components/ui/dither-shell", () => ({
  DitherShell: () => <div>Loading organization</div>
}))

const initialOrg = {
  id: "org-1",
  slug: "test",
  name: "Original organization",
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null as string | null,
  purgeAt: null as string | null
}

function OrgConsumer() {
  const org = useAtomValue(orgDetailAtom("test"))
  return <div>{Result.isSuccess(org) ? org.value.name : "Waiting for org"}</div>
}

let registry: Registry.AtomRegistry

function load(abortController = new AbortController()) {
  const loader = Route.options.loader
  if (typeof loader !== "function") throw new Error("Missing org loader")
  return loader({
    context: { registry },
    params: { orgSlug: "test" },
    abortController
  } as Parameters<typeof loader>[0])
}

function renderLayout() {
  const Layout = Route.options.component
  if (!Layout) throw new Error("Missing org layout")
  return render(
    <RegistryContext.Provider value={registry}>
      <Layout />
    </RegistryContext.Provider>
  )
}

beforeEach(() => {
  registry = Registry.make()
  vi.spyOn(Route, "useParams").mockReturnValue({ orgSlug: "test" })
})

afterEach(() => {
  cleanup()
  registry.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("org route data ownership", () => {
  it("shares a pending request between the loader, repeated preloads, and consumers", async () => {
    let finish = (_response: Response) => {}
    const response = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi.fn(() => response)
    vi.stubGlobal("fetch", fetch)

    const firstLoad = load()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const secondLoad = load()
    renderLayout()
    const release = registry.mount(orgDetailAtom("test"))
    expect(screen.getByText("Loading organization")).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)

    await act(async () => {
      finish(Response.json(initialOrg))
      await Promise.all([firstLoad, secondLoad])
    })
    expect(await screen.findByText(initialOrg.name)).toBeTruthy()
    await load()
    expect(fetch).toHaveBeenCalledTimes(1)
    release()
  })

  it("reuses the retained base after an unused preload wrapper is removed", async () => {
    const fetch = vi.fn(async () => Response.json(initialOrg))
    vi.stubGlobal("fetch", fetch)
    await load()
    await vi.waitFor(() =>
      expect(registry.getNodes().has(orgDetailAtom("test"))).toBe(false)
    )
    await load()
    renderLayout()
    expect(await screen.findByText(initialOrg.name)).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("keeps the shared request available when a preload is aborted", async () => {
    let finish = (_response: Response) => {}
    const response = new Promise<Response>((resolve) => {
      finish = resolve
    })
    const fetch = vi.fn(() => response)
    vi.stubGlobal("fetch", fetch)
    const controller = new AbortController()
    const preloading = load(controller)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    controller.abort()
    await preloading
    const navigation = load()
    finish(Response.json(initialOrg))
    await navigation
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [404, { _tag: "NotFound" }, "Organization not found"],
    [403, { _tag: "Forbidden" }, "Retry organization"],
    [200, { invalid: true }, "Retry organization"]
  ])(
    "renders an org failure (%s) instead of child content",
    async (status, body, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(body, { status }))
      )
      await load()
      renderLayout()
      expect(await screen.findByText(message)).toBeTruthy()
      expect(screen.queryByText(initialOrg.name)).toBeNull()
    }
  )

  it("retries the base request after a failed read", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ _tag: "Unauthorized" }, { status: 401 })
      )
      .mockImplementation(async () => Response.json(initialOrg))
    vi.stubGlobal("fetch", fetch)
    await load()
    renderLayout()
    fireEvent.click(await screen.findByText("Retry organization"))
    expect(await screen.findByText(initialOrg.name)).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("reflects rename, deletion, and restoration without rerunning the loader", async () => {
    let org = { ...initialOrg }
    updateOrganization.mockImplementation(async () => {
      org = { ...org, name: "Renamed organization" }
      return { data: org, error: null }
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
          "http://localhost"
        )
        if (url.pathname.endsWith("/soft-delete")) {
          org = { ...org, deletedAt: "2026-09-09T00:00:00.000Z" }
        }
        if (url.pathname.endsWith("/restore")) org = { ...org, deletedAt: null }
        return Response.json(org)
      })
    )
    await load()
    renderLayout()
    expect(await screen.findByText(initialOrg.name)).toBeTruthy()

    registry.mount(renameOrgAtom("test"))
    registry.mount(softDeleteOrgAtom("test"))
    registry.mount(restoreOrgAtom("test"))
    act(() =>
      registry.set(renameOrgAtom("test"), { name: "Renamed organization" })
    )
    expect(await screen.findByText("Renamed organization")).toBeTruthy()
    await vi.waitFor(() =>
      expect(registry.get(renameOrgAtom("test"))).toMatchObject({
        _tag: "Success",
        waiting: false
      })
    )

    act(() => registry.set(softDeleteOrgAtom("test"), undefined))
    expect(await screen.findByText("Deleted organization")).toBeTruthy()
    expect(screen.queryByText("Renamed organization")).toBeNull()

    act(() => registry.set(restoreOrgAtom("test"), undefined))
    expect(await screen.findByText("Renamed organization")).toBeTruthy()
    expect(screen.queryByText("Deleted organization")).toBeNull()
  })
})

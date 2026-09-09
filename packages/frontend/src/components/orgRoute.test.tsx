import { RegistryContext, useAtomValue } from "@effect/atom-react"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { orgDetailAtom, restoreOrgAtom, softDeleteOrgAtom } from "@/atoms/orgs"
import { Route } from "@/routes/_authed/orgs/$orgSlug/route"

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

function stubOrgFetch(handler: typeof fetch) {
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      "http://localhost"
    )
    return url.pathname.endsWith("/projects")
      ? Promise.resolve(Response.json([]))
      : handler(input, init)
  })
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
    stubOrgFetch(fetch)

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

  it("retries the base request after a failed read", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ _tag: "Unauthorized" }, { status: 401 })
      )
      .mockImplementation(async () => Response.json(initialOrg))
    stubOrgFetch(fetch)
    await load()
    renderLayout()
    fireEvent.click(await screen.findByText("Retry organization"))
    expect(await screen.findByText(initialOrg.name)).toBeTruthy()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("switches between active and deleted org content after mutations", async () => {
    let org = { ...initialOrg }
    stubOrgFetch(
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

    registry.mount(softDeleteOrgAtom("test"))
    registry.mount(restoreOrgAtom("test"))
    act(() => registry.set(softDeleteOrgAtom("test"), undefined))
    expect(await screen.findByText("Deleted organization")).toBeTruthy()
    expect(screen.queryByText(initialOrg.name)).toBeNull()

    act(() => registry.set(restoreOrgAtom("test"), undefined))
    expect(await screen.findByText(initialOrg.name)).toBeTruthy()
    expect(screen.queryByText("Deleted organization")).toBeNull()
  })
})

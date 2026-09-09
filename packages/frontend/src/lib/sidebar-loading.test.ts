import { createMemoryHistory, createRouter } from "@tanstack/react-router"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { afterEach, expect, it, vi } from "vite-plus/test"
import { projectsListAtom } from "@/atoms/projects"
import { routeTree } from "@/routeTree.gen"

const registries: Array<Registry.AtomRegistry> = []
const org = {
  id: "org-1",
  slug: "fixture",
  name: "Fixture",
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
  purgeAt: null
}
const project = {
  org: "fixture",
  slug: "project",
  key: "T",
  name: "Project",
  icon: "🔧",
  color: "#aaaaaa",
  createdBy: "user-1",
  createdAt: org.createdAt
}

function setup(
  projectResponse: Response,
  orgResponse = Promise.resolve(Response.json(org))
) {
  const requested: string[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input) => {
      const path = new URL(
        input instanceof Request ? input.url : String(input),
        "http://localhost"
      ).pathname
      requested.push(path)
      if (path === "/api/orgs/fixture") return orgResponse
      if (path === "/api/orgs/fixture/projects") return projectResponse.clone()
      throw new Error(`Unexpected request: ${path}`)
    })
  )
  const registry = Registry.make()
  registries.push(registry)
  const router = createRouter({
    routeTree,
    context: { registry },
    history: createMemoryHistory({ initialEntries: ["/orgs/fixture/projects"] })
  })
  return { registry, router, requested }
}

afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose()
  vi.unstubAllGlobals()
})

it.each([{ projects: [project] }, { projects: [] }])(
  "preloads sidebar rows alongside the org request and retains them for mount: $projects.length rows",
  async ({ projects }) => {
    let releaseOrg: (() => void) | undefined
    const orgResponse = new Promise<Response>((resolve) => {
      releaseOrg = () => resolve(Response.json(org))
    })
    const { registry, router, requested } = setup(
      Response.json(projects),
      orgResponse
    )
    const loading = router.load()
    try {
      await vi.waitFor(() =>
        expect(requested).toContain("/api/orgs/fixture/projects")
      )
    } finally {
      releaseOrg?.()
      await loading
    }
    const result = registry.get(projectsListAtom("fixture"))
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result))
      expect(result.value.map((p) => p.slug)).toEqual(
        projects.map((p) => p.slug)
      )
    const unmount = registry.mount(projectsListAtom("fixture"))
    await router.invalidate()
    expect(requested.filter((path) => path.endsWith("/projects"))).toHaveLength(
      1
    )
    unmount()
  }
)

it.each([
  Response.json({ _tag: "Unauthorized" }, { status: 401 }),
  Response.json({ malformed: true })
])(
  "does not turn a project-list failure into an org route error",
  async (response) => {
    const { registry, router } = setup(response)
    await router.load()
    expect(
      router.state.matches.every((match) => match.status === "success")
    ).toBe(true)
    expect(Result.isFailure(registry.get(projectsListAtom("fixture")))).toBe(
      true
    )
  }
)

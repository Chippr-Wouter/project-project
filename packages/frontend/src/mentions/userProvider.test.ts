import * as Effect from "effect/Effect"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import { afterEach, expect, it, vi } from "vitest"
import { meAtom } from "@/atoms/auth"
import { AppLayer } from "@/runtime"
import { userMentionProvider } from "./userProvider"

afterEach(() => vi.unstubAllGlobals())

it("reuses cached identity for repeated mentions and matches supplied members without requests", async () => {
  const registry = Registry.make()
  const fetch = vi.fn(async () =>
    Response.json({
      id: "user-1",
      name: "Luuk",
      username: "luuk",
      email: "luuk@example.com",
      image: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      activeOrgSlug: "org",
      editorPreference: "github",
      personalGithub: { connected: false },
      personalEverhour: {
        connected: false,
        everhourUserId: null,
        name: null,
        email: null,
        lastVerifiedAt: null,
        lastCheckError: null
      }
    })
  )
  vi.stubGlobal("fetch", fetch)
  const scope = { orgSlug: "org", slug: "project" }
  const search = (q: string, members?: (typeof member)[]) =>
    Effect.runPromise(
      userMentionProvider
        .search(q, { ...scope, members })
        .pipe(
          Effect.provideService(Registry.AtomRegistry, registry),
          Effect.provide(AppLayer)
        )
    )
  const member = {
    id: "member-1",
    name: "Wouter",
    username: "wvh",
    email: "wouter@example.com",
    image: null,
    role: "member" as const
  }
  try {
    await Effect.runPromise(Registry.getResult(registry, meAtom))
    expect(await search("lu")).toEqual([
      { id: "user-1", label: "Luuk", image: null }
    ])
    expect(await search("user-1")).toHaveLength(1)
    expect(await search("missing")).toEqual([])
    for (const q of ["wouter", "wvh", "example.com"]) {
      expect(await search(q, [member])).toEqual([
        {
          id: "member-1",
          label: "Wouter",
          secondary: member.email,
          image: null
        }
      ])
    }
    expect(fetch).toHaveBeenCalledOnce()
  } finally {
    registry.dispose()
  }
})

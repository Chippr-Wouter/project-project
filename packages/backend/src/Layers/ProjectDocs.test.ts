import { it } from "@effect/vitest"
import { expect } from "vite-plus/test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { Markdown } from "../Services/Markdown"
import { ProjectDocs } from "../Services/ProjectDocs"
import { ProjectDocsLive } from "./ProjectDocs"

const base = {
  org: "demo",
  slug: "demo",
  key: "DEMO",
  name: "Demo",
  createdAt: "2026-09-09T00:00:00.000Z",
  members: []
}

for (const banner of [
  null,
  { type: "preset", preset: "sunset", crop: { x: 0.5, y: 0.65, zoom: 1.5 } },
  {
    type: "attachment",
    attachmentId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    crop: { x: 0, y: 1, zoom: 4 }
  }
] as const) {
  it.effect(
    `round-trips ${banner?.type ?? "empty"} banners through project markdown`,
    () => {
      let data: Record<string, unknown> = { ...base, banner }
      const layer = ProjectDocsLive.pipe(
        Layer.provide(
          Layer.mock(Markdown, {
            root: "/tmp",
            projectDir: () => "/tmp/demo",
            readProjectFile: () =>
              Effect.succeed({ data, body: "# Demo", path: "project.md" }),
            writeProjectFile: (_org, _slug, next) =>
              Effect.sync(() => {
                data = next
              })
          })
        )
      )
      return Effect.gen(function* () {
        const docs = yield* ProjectDocs
        const original = yield* docs.read("demo", "demo")
        yield* docs.write("demo", "demo", {
          ...original,
          org: "demo",
          key: original.key!,
          createdBy: "owner"
        })
        const restored = yield* docs.read("demo", "demo")
        expect(restored.banner).toEqual(banner)
        expect(restored.body).toBe("# Demo")
      }).pipe(Effect.provide(layer))
    }
  )
}

it.effect("loads existing projects without a banner", () =>
  Effect.gen(function* () {
    const docs = yield* ProjectDocs
    expect((yield* docs.read("demo", "demo")).banner).toBeNull()
  }).pipe(
    Effect.provide(
      ProjectDocsLive.pipe(
        Layer.provide(
          Layer.mock(Markdown, {
            root: "/tmp",
            projectDir: () => "/tmp/demo",
            readProjectFile: () =>
              Effect.succeed({ data: base, body: "", path: "project.md" })
          })
        )
      )
    )
  )
)

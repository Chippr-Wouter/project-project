import { FileSystem, Path } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"
import { it } from "@effect/vitest"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect } from "vite-plus/test"
import { Markdown } from "../Services/Markdown"
import { MarkdownLive } from "./Markdown"

const TestLayer = Layer.unwrapScoped(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "projectproject-md-"
    })
    return MarkdownLive.pipe(
      Layer.provideMerge(
        Layer.setConfigProvider(
          ConfigProvider.fromMap(new Map([["PROJECTS_DIR", tmpRoot]]))
        )
      )
    )
  })
).pipe(Layer.provideMerge(BunContext.layer))

const projectFrontmatter = (slug: string) => ({
  org: "acme",
  slug,
  key: "T",
  name: slug,
  createdBy: "user-1",
  createdAt: "2026-05-19T00:00:00.000Z",
  members: []
})

const ticketFrontmatter = (id: string) => ({
  id,
  title: id,
  status: "todo",
  type: "other",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  lastTransitionedPr: null,
  assignees: [],
  createdBy: "user-1",
  createdAt: "2026-05-19T00:00:00.000Z",
  updatedAt: "2026-05-19T00:00:00.000Z"
})

describe("Markdown deletion (real fs)", () => {
  it.scoped(
    "removeTicketFile removes the file and listTicketIds reflects it",
    () =>
      Effect.gen(function* () {
        const md = yield* Markdown
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* Config.string("PROJECTS_DIR")

        yield* md.createTicketFile(
          "acme",
          "foo",
          "T-1",
          ticketFrontmatter("T-1"),
          "# T-1 body\n"
        )
        expect(yield* md.listTicketIds("acme", "foo")).toEqual(["T-1"])

        const filePath = path.join(
          root,
          "orgs",
          "acme",
          "projects",
          "foo",
          "tickets",
          "T-1.md"
        )
        expect(yield* fs.exists(filePath)).toBe(true)

        yield* md.removeTicketFile("acme", "foo", "T-1")
        expect(yield* fs.exists(filePath)).toBe(false)
        expect(yield* md.listTicketIds("acme", "foo")).toEqual([])
      }).pipe(Effect.provide(TestLayer))
  )

  it.scoped(
    "removeProjectDir removes the entire project tree including tickets",
    () =>
      Effect.gen(function* () {
        const md = yield* Markdown
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* Config.string("PROJECTS_DIR")

        yield* md.writeProjectFile(
          "acme",
          "foo",
          projectFrontmatter("foo"),
          "# Foo\n"
        )
        yield* md.createTicketFile(
          "acme",
          "foo",
          "T-1",
          ticketFrontmatter("T-1"),
          "# T-1\n"
        )
        yield* md.createTicketFile(
          "acme",
          "foo",
          "T-2",
          ticketFrontmatter("T-2"),
          "# T-2 with notes\n"
        )

        const dir = path.join(root, "orgs", "acme", "projects", "foo")
        expect(yield* fs.exists(dir)).toBe(true)

        yield* md.removeProjectDir("acme", "foo")
        expect(yield* fs.exists(dir)).toBe(false)
        expect(yield* md.listTicketIds("acme", "foo")).toEqual([])
      }).pipe(Effect.provide(TestLayer))
  )

  it.scoped(
    "project re-created under same slug after removeProjectDir is empty of old tickets",
    () =>
      Effect.gen(function* () {
        const md = yield* Markdown
        yield* md.writeProjectFile(
          "acme",
          "foo",
          projectFrontmatter("foo"),
          "# Foo\n"
        )
        yield* md.createTicketFile(
          "acme",
          "foo",
          "T-1",
          ticketFrontmatter("T-1"),
          "# leaked notes\n"
        )
        yield* md.removeProjectDir("acme", "foo")
        yield* md.writeProjectFile(
          "acme",
          "foo",
          projectFrontmatter("foo"),
          "# Foo (recreated)\n"
        )
        expect(yield* md.listTicketIds("acme", "foo")).toEqual([])
      }).pipe(Effect.provide(TestLayer))
  )
})

import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as BunServices from "@effect/platform-bun/BunServices"
import { it } from "@effect/vitest"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect } from "vite-plus/test"
import { Markdown } from "../Services/Markdown"
import { MarkdownLive } from "./Markdown"

const TestLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "projectproject-md-"
    })
    return MarkdownLive.pipe(
      Layer.provideMerge(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ PROJECTS_DIR: tmpRoot })
        )
      )
    )
  })
).pipe(Layer.provideMerge(BunServices.layer))

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

describe("Markdown tickets (real fs)", () => {
  it.effect("keeps the original ticket when exclusive creation collides", () =>
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
        "# Original\n"
      )
      const error = yield* md
        .createTicketFile(
          "acme",
          "foo",
          "T-1",
          ticketFrontmatter("T-1"),
          "# Replacement\n"
        )
        .pipe(Effect.flip)
      const file = path.join(
        root,
        "orgs",
        "acme",
        "projects",
        "foo",
        "tickets",
        "T-1.md"
      )
      const entries = yield* fs.readDirectory(path.dirname(file))

      expect(error._tag).toBe("TicketIdTaken")
      expect(yield* fs.readFileString(file, "utf8")).toContain("# Original")
      expect(entries).toEqual(["T-1.md"])
    }).pipe(Effect.provide(TestLayer))
  )

  it.effect(
    "atomically replaces a ticket without leaving temporary files",
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
          "# Before\n"
        )
        yield* md.writeTicketFile(
          "acme",
          "foo",
          "T-1",
          { ...ticketFrontmatter("T-1"), title: "After" },
          "# After\n"
        )
        const file = path.join(
          root,
          "orgs",
          "acme",
          "projects",
          "foo",
          "tickets",
          "T-1.md"
        )
        const entries = yield* fs.readDirectory(path.dirname(file))

        expect(yield* fs.readFileString(file, "utf8")).toContain("# After")
        expect(entries).toEqual(["T-1.md"])
      }).pipe(Effect.provide(TestLayer))
  )
})

describe("Markdown deletion (real fs)", () => {
  it.effect(
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

  it.effect(
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

  it.effect(
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

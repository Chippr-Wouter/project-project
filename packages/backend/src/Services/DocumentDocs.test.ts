import { it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { expect } from "vite-plus/test"

const isoDate = (s: string) => DateTime.toDate(DateTime.unsafeMake(s))
import {
  GroupColor,
  GroupId,
  ProjectKey,
  TagName,
  TicketId,
  TicketStatus
} from "@projectproject/shared"
import { GroupDocsLive } from "../Layers/GroupDocs"
import { ProjectDocsLive } from "../Layers/ProjectDocs"
import { TicketDocsLive } from "../Layers/TicketDocs"
import { GroupDocs } from "./GroupDocs"
import { Markdown, type MarkdownShape } from "./Markdown"
import { ProjectDocs } from "./ProjectDocs"
import { TicketDocs } from "./TicketDocs"

const groupId = Schema.decodeUnknownSync(GroupId)
const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)
const projectKey = Schema.decodeUnknownSync(ProjectKey)
const tagName = Schema.decodeUnknownSync(TagName)
const groupColor = Schema.decodeUnknownSync(GroupColor)

function unexpectedMarkdownCall(method: string): Effect.Effect<never> {
  return Effect.die(new Error(`unexpected Markdown.${method} call`))
}

function makeMarkdown(overrides: Partial<MarkdownShape>) {
  const service = {
    root: "/tmp/projectproject-test",
    projectDir: (orgSlug: string, projectSlug: string) =>
      `/tmp/projectproject-test/orgs/${orgSlug}/projects/${projectSlug}`,
    readProjectFile: () => unexpectedMarkdownCall("readProjectFile"),
    readProjectFileRaw: () => unexpectedMarkdownCall("readProjectFileRaw"),
    writeProjectFile: () => unexpectedMarkdownCall("writeProjectFile"),
    removeProjectDir: () => unexpectedMarkdownCall("removeProjectDir"),
    readTicketFile: () => unexpectedMarkdownCall("readTicketFile"),
    readTicketParts: () => unexpectedMarkdownCall("readTicketParts"),
    readTicketFileRaw: () => unexpectedMarkdownCall("readTicketFileRaw"),
    createTicketFile: () => unexpectedMarkdownCall("createTicketFile"),
    writeTicketFile: () => unexpectedMarkdownCall("writeTicketFile"),
    writeTicketWithRegion: () =>
      unexpectedMarkdownCall("writeTicketWithRegion"),
    removeTicketFile: () => unexpectedMarkdownCall("removeTicketFile"),
    listTicketIds: () => unexpectedMarkdownCall("listTicketIds"),
    readGroupFile: () => unexpectedMarkdownCall("readGroupFile"),
    readGroupFileRaw: () => unexpectedMarkdownCall("readGroupFileRaw"),
    createGroupFile: () => unexpectedMarkdownCall("createGroupFile"),
    writeGroupFile: () => unexpectedMarkdownCall("writeGroupFile"),
    writeGroupFileIfExists: () =>
      unexpectedMarkdownCall("writeGroupFileIfExists"),
    removeGroupFile: () => unexpectedMarkdownCall("removeGroupFile"),
    listGroupIds: () => unexpectedMarkdownCall("listGroupIds"),
    ...overrides
  } satisfies MarkdownShape

  return Layer.succeed(Markdown, service)
}

it.effect(
  "TicketDocs reads legacy ticket frontmatter as a typed document",
  () =>
    Effect.gen(function* () {
      const docs = yield* TicketDocs
      const document = yield* docs.read("org", "project", "T-1")

      expect(document).toMatchObject({
        id: "T-1",
        title: "Fix auth",
        status: ticketStatus("todo"),
        type: "bug",
        priority: "med",
        tags: [],
        branch: null,
        pr: null,
        prState: null,
        lastTransitionedPr: null,
        assignees: ["user-1"],
        createdBy: "user-2",
        body: "# Fix auth\n"
      })
      expect(document.createdAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
      expect(document.updatedAt.toISOString()).toBe("2026-01-02T00:00:00.000Z")
    }).pipe(
      Effect.provide(
        TicketDocsLive.pipe(
          Layer.provide(
            makeMarkdown({
              readTicketParts: () =>
                Effect.succeed({
                  data: {
                    id: "T-1",
                    title: "Fix auth",
                    status: ticketStatus("todo"),
                    type: "bug",
                    branch: null,
                    assignee: "user-1",
                    createdBy: "user-2",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-02T00:00:00.000Z"
                  },
                  description: "# Fix auth\n",
                  region: ""
                })
            })
          )
        )
      )
    )
)

it.effect(
  "TicketDocs serializes typed ticket documents for disk writes",
  () => {
    let written:
      | {
          id: string
          frontmatter: Record<string, unknown>
          body: string
        }
      | undefined

    return Effect.gen(function* () {
      const docs = yield* TicketDocs
      yield* docs.write("org", "project", "T-2", {
        id: ticketId("T-2"),
        title: "Write tests",
        status: ticketStatus("in_progress"),
        type: "chore",
        priority: "high",
        tags: [tagName("backend")],
        branch: "chore/T-2-write-tests",
        pr: 42,
        prState: "open",
        lastTransitionedPr: null,
        assignees: ["user-1", "user-2"],
        archivedAt: null,
        createdBy: "user-1",
        createdAt: isoDate("2026-02-01T10:00:00.000Z"),
        updatedAt: isoDate("2026-02-02T10:00:00.000Z"),
        body: "# Write tests\n"
      })

      expect(written).toEqual({
        id: "T-2",
        frontmatter: {
          id: "T-2",
          title: "Write tests",
          status: ticketStatus("in_progress"),
          type: "chore",
          priority: "high",
          tags: ["backend"],
          branch: "chore/T-2-write-tests",
          pr: 42,
          prState: "open",
          lastTransitionedPr: null,
          assignees: ["user-1", "user-2"],
          archivedAt: null,
          createdBy: "user-1",
          createdAt: "2026-02-01T10:00:00.000Z",
          updatedAt: "2026-02-02T10:00:00.000Z"
        },
        body: "# Write tests\n"
      })
    }).pipe(
      Effect.provide(
        TicketDocsLive.pipe(
          Layer.provide(
            makeMarkdown({
              readTicketParts: () =>
                Effect.succeed({ data: {}, description: "", region: "" }),
              writeTicketWithRegion: (_org, _slug, id, frontmatter, body) => {
                written = { id, frontmatter, body }
                return Effect.void
              }
            })
          )
        )
      )
    )
  }
)

it.effect("GroupDocs reads missing optional fields as typed defaults", () =>
  Effect.gen(function* () {
    const docs = yield* GroupDocs
    const document = yield* docs.read("org", "project", "G-1")

    expect(document).toMatchObject({
      id: "G-1",
      name: "Backlog",
      kind: "other",
      tickets: [],
      color: "#7c3aed",
      startsAt: null,
      endsAt: null,
      completedAt: null,
      createdBy: "user-1",
      body: "# Backlog\n"
    })
    expect(document.createdAt.toISOString()).toBe("2026-03-01T00:00:00.000Z")
    expect(document.updatedAt.toISOString()).toBe("2026-03-02T00:00:00.000Z")
  }).pipe(
    Effect.provide(
      GroupDocsLive.pipe(
        Layer.provide(
          makeMarkdown({
            readGroupFile: () =>
              Effect.succeed({
                data: {
                  id: "G-1",
                  name: "Backlog",
                  color: "#7c3aed",
                  createdBy: "user-1",
                  createdAt: "2026-03-01T00:00:00.000Z",
                  updatedAt: "2026-03-02T00:00:00.000Z"
                },
                body: "# Backlog\n"
              })
          })
        )
      )
    )
  )
)

it.effect("GroupDocs serializes typed group documents for disk writes", () => {
  let written:
    | {
        id: string
        frontmatter: Record<string, unknown>
        body: string
      }
    | undefined

  return Effect.gen(function* () {
    const docs = yield* GroupDocs
    yield* docs.writeIfExists("org", "project", "G-2", {
      id: groupId("G-2"),
      name: "Sprint 1",
      kind: "sprint",
      tickets: [ticketId("T-1"), ticketId("T-2")],
      color: groupColor("#10b981"),
      startsAt: isoDate("2026-04-01T00:00:00.000Z"),
      endsAt: isoDate("2026-04-14T00:00:00.000Z"),
      completedAt: null,
      createdBy: "user-1",
      createdAt: isoDate("2026-03-30T00:00:00.000Z"),
      updatedAt: isoDate("2026-04-02T00:00:00.000Z"),
      body: "# Sprint 1\n"
    })

    expect(written).toEqual({
      id: "G-2",
      frontmatter: {
        id: "G-2",
        name: "Sprint 1",
        kind: "sprint",
        tickets: ["T-1", "T-2"],
        color: "#10b981",
        startsAt: "2026-04-01T00:00:00.000Z",
        endsAt: "2026-04-14T00:00:00.000Z",
        completedAt: null,
        createdBy: "user-1",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-04-02T00:00:00.000Z"
      },
      body: "# Sprint 1\n"
    })
  }).pipe(
    Effect.provide(
      GroupDocsLive.pipe(
        Layer.provide(
          makeMarkdown({
            writeGroupFileIfExists: (_org, _slug, id, frontmatter, body) => {
              written = { id, frontmatter, body }
              return Effect.void
            }
          })
        )
      )
    )
  )
})

it.effect("ProjectDocs reads project frontmatter with typed defaults", () =>
  Effect.gen(function* () {
    const docs = yield* ProjectDocs
    const document = yield* docs.read("org", "project")

    expect(document).toMatchObject({
      org: "org",
      slug: "project",
      name: "Project",
      members: [],
      github: null,
      body: "# Project\n"
    })
    expect(document.createdAt.toISOString()).toBe("2026-05-01T00:00:00.000Z")
  }).pipe(
    Effect.provide(
      ProjectDocsLive.pipe(
        Layer.provide(
          makeMarkdown({
            readProjectFile: () =>
              Effect.succeed({
                data: {
                  org: "org",
                  slug: "project",
                  name: "Project",
                  createdAt: "2026-05-01T00:00:00.000Z"
                },
                body: "# Project\n"
              })
          })
        )
      )
    )
  )
)

it.effect(
  "ProjectDocs serializes typed project documents for disk writes",
  () => {
    let written:
      | {
          slug: string
          frontmatter: Record<string, unknown>
          body: string
        }
      | undefined

    return Effect.gen(function* () {
      const docs = yield* ProjectDocs
      yield* docs.write("org", "project", {
        org: "org",
        slug: "project",
        key: projectKey("FOO"),
        name: "Project",
        icon: "🚀",
        color: "#53a0ff",
        createdBy: "user-1",
        createdAt: isoDate("2026-05-02T00:00:00.000Z"),
        members: [{ username: "wouter", role: "owner" }],
        github: {
          repoId: "repo-1",
          repoOwner: "wouter",
          repoName: "project",
          defaultBaseBranch: null
        },
        setup: {
          workflowReviewedAt: null,
          invitePeopleDismissedAt: null,
          connectGithubDismissedAt: null
        },
        body: "# Project\n"
      })

      expect(written).toEqual({
        slug: "project",
        frontmatter: {
          org: "org",
          slug: "project",
          key: "FOO",
          name: "Project",
          icon: "🚀",
          color: "#53a0ff",
          createdBy: "user-1",
          createdAt: "2026-05-02T00:00:00.000Z",
          members: [{ username: "wouter", role: "owner" }],
          github: {
            repoId: "repo-1",
            repoOwner: "wouter",
            repoName: "project",
            defaultBaseBranch: null
          },
          setup: {
            workflowReviewedAt: null,
            invitePeopleDismissedAt: null,
            connectGithubDismissedAt: null
          }
        },
        body: "# Project\n"
      })
    }).pipe(
      Effect.provide(
        ProjectDocsLive.pipe(
          Layer.provide(
            makeMarkdown({
              writeProjectFile: (_org, projectSlug, frontmatter, body) => {
                written = { slug: projectSlug, frontmatter, body }
                return Effect.void
              }
            })
          )
        )
      )
    )
  }
)

it.effect(
  "ProjectDocs.readRaw returns the on-disk path and raw file contents",
  () =>
    Effect.gen(function* () {
      const docs = yield* ProjectDocs
      const file = yield* docs.readRaw("acme", "web")
      expect(file).toEqual({
        path: "project.md",
        content: "---\nslug: web\n---\n# Web\n"
      })
    }).pipe(
      Effect.provide(
        ProjectDocsLive.pipe(
          Layer.provide(
            makeMarkdown({
              readProjectFileRaw: (_org, _slug) =>
                Effect.succeed({
                  path: "project.md",
                  content: "---\nslug: web\n---\n# Web\n"
                })
            })
          )
        )
      )
    )
)

it.effect(
  "TicketDocs.readRaw returns the on-disk path and raw file contents",
  () =>
    Effect.gen(function* () {
      const docs = yield* TicketDocs
      const file = yield* docs.readRaw("acme", "web", "T-12")
      expect(file).toEqual({
        path: "tickets/T-12.md",
        content: "---\nid: T-12\n---\n# Fix it\n"
      })
    }).pipe(
      Effect.provide(
        TicketDocsLive.pipe(
          Layer.provide(
            makeMarkdown({
              readTicketFileRaw: (_org, _slug, _id) =>
                Effect.succeed({
                  path: "tickets/T-12.md",
                  content: "---\nid: T-12\n---\n# Fix it\n"
                })
            })
          )
        )
      )
    )
)

it.effect(
  "GroupDocs.readRaw returns the on-disk path and raw file contents",
  () =>
    Effect.gen(function* () {
      const docs = yield* GroupDocs
      const file = yield* docs.readRaw("acme", "web", "G-3")
      expect(file).toEqual({
        path: "groups/G-3.md",
        content: "---\nid: G-3\n---\n# Sprint 3\n"
      })
    }).pipe(
      Effect.provide(
        GroupDocsLive.pipe(
          Layer.provide(
            makeMarkdown({
              readGroupFileRaw: (_org, _slug, _id) =>
                Effect.succeed({
                  path: "groups/G-3.md",
                  content: "---\nid: G-3\n---\n# Sprint 3\n"
                })
            })
          )
        )
      )
    )
)

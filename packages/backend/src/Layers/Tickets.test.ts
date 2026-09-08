import * as TicketDocumentLock from "../ticketDocumentLock"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as BunServices from "@effect/platform-bun/BunServices"
import { it } from "@effect/vitest"
import * as Config from "effect/Config"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { expect } from "vite-plus/test"
import { ProjectKey, type TicketStatus } from "@projectproject/shared"
import { Attachments, type AttachmentsShape } from "../Services/Attachments"
import { Db } from "../Services/Db"
import { Comments, type CommentsShape } from "../Services/Comments"
import { GitHub, type GitHubShape } from "../Services/GitHub"
import { Groups, type GroupsShape } from "../Services/Groups"
import { Projects, type ProjectsShape } from "../Services/Projects"
import { TicketIndex, type TicketIndexShape } from "../Services/TicketIndex"
import { Tickets } from "../Services/Tickets"
import { MarkdownLive } from "./Markdown"
import { TicketDocsLive } from "./TicketDocs"
import { TicketsLive } from "./Tickets"

const decodeProjectKey = Schema.decodeUnknownSync(ProjectKey)

function unexpected(method: string): Effect.Effect<never> {
  return Effect.die(new Error(`unexpected ${method} call`))
}

const FakeProjects = Layer.succeed(Projects, {
  list: () => unexpected("Projects.list"),
  listPaged: () => unexpected("Projects.listPaged"),
  listMembersPaged: () => unexpected("Projects.listMembersPaged"),
  create: () => unexpected("Projects.create"),
  get: () => unexpected("Projects.get"),
  getKey: () => Effect.succeed(decodeProjectKey("T")),
  getGithubIntegration: () => Effect.succeed(null),
  update: () => unexpected("Projects.update"),
  updateSetup: () => unexpected("Projects.updateSetup"),
  remove: () => unexpected("Projects.remove"),
  requireMember: () => Effect.succeed({ role: "member" as const }),
  requireRole: () => unexpected("Projects.requireRole"),
  addMember: () => unexpected("Projects.addMember"),
  updateMember: () => unexpected("Projects.updateMember"),
  transferOwnership: () => unexpected("Projects.transferOwnership"),
  removeMember: () => unexpected("Projects.removeMember"),
  cancelPendingMember: () => unexpected("Projects.cancelPendingMember"),
  unassignUserFromActiveTickets: () =>
    unexpected("Projects.unassignUserFromActiveTickets"),
  connectGithub: () => unexpected("Projects.connectGithub"),
  disconnectGithub: () => unexpected("Projects.disconnectGithub")
} satisfies ProjectsShape)

const FakeGroups = Layer.succeed(Groups, {
  list: () => unexpected("Groups.list"),
  listPaged: () => unexpected("Groups.listPaged"),
  listSprintsPaged: () => unexpected("Groups.listSprintsPaged"),
  get: () => unexpected("Groups.get"),
  create: () => unexpected("Groups.create"),
  update: () => unexpected("Groups.update"),
  updateTickets: () => unexpected("Groups.updateTickets"),
  addTickets: () => unexpected("Groups.addTickets"),
  updateTicketOrder: () => unexpected("Groups.updateTicketOrder"),
  complete: () => unexpected("Groups.complete"),
  remove: () => unexpected("Groups.remove"),
  removeTicketFromAllGroups: () => Effect.void
} satisfies GroupsShape)

const FakeGitHub = Layer.succeed(GitHub, {
  getInstallationAccount: () => unexpected("GitHub.getInstallationAccount"),
  listInstallationRepos: () => unexpected("GitHub.listInstallationRepos"),
  verifyInstallationRepo: () => unexpected("GitHub.verifyInstallationRepo"),
  exchangeAppUserCode: () => unexpected("GitHub.exchangeAppUserCode"),
  appUserCanAccessInstallation: () =>
    unexpected("GitHub.appUserCanAccessInstallation"),
  createBranchAsUser: () => unexpected("GitHub.createBranchAsUser"),
  openPullRequestAsUser: () => unexpected("GitHub.openPullRequestAsUser"),
  fetchInstallationProjectStates: () =>
    unexpected("GitHub.fetchInstallationProjectStates"),
  listInstallationBranches: () => unexpected("GitHub.listInstallationBranches"),
  branchExistsInstallation: () => unexpected("GitHub.branchExistsInstallation")
} satisfies GitHubShape)

const recordedCommentBodies: Array<string> = []

const FakeComments = Layer.succeed(Comments, {
  list: () => unexpected("Comments.list"),
  create: (_orgSlug, _userId, _slug, _ticketId, input) => {
    recordedCommentBodies.push(input.body)
    return Effect.succeed({} as never)
  },
  edit: () => unexpected("Comments.edit"),
  remove: () => unexpected("Comments.remove")
} satisfies CommentsShape)

const ticketIndexProject = {
  orgSlug: "org",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "p"
}

const FakeTicketIndex = Layer.succeed(TicketIndex, {
  projectFor: () => Effect.succeed(ticketIndexProject),
  list: () => Effect.succeed([]),
  listIds: () => Effect.succeed([]),
  tagUsageCounts: () => Effect.succeed({}),
  findTicketIdsByTag: () => Effect.succeed([]),
  findTicketIdsByStatus: () => Effect.succeed([]),
  findTicketsByBranch: () => Effect.succeed([]),
  isRepositoryBranchAttached: () => Effect.succeed(false),
  upsertTicket: () => Effect.void,
  markBranchStale: () => Effect.succeed([]),
  clearBranchStale: () => Effect.void,
  updateBranchChecks: () => Effect.succeed([]),
  deleteTicket: () => Effect.void,
  rebuildProject: () =>
    Effect.succeed({ project: ticketIndexProject, indexed: 0, skipped: 0 }),
  rebuildAllProjects: () => Effect.succeed({ projects: [] }),
  reconcileProject: () =>
    Effect.succeed({
      project: ticketIndexProject,
      drift: { missing: [], orphaned: [], stale: [] },
      rebuilt: false,
      indexed: 0,
      skipped: 0
    }),
  reconcileAllProjects: () => Effect.succeed({ projects: [], reconciled: 0 })
} satisfies TicketIndexShape)

const FakeAttachments = Layer.succeed(Attachments, {
  prepare: () => unexpected("Attachments.prepare"),
  commit: () => unexpected("Attachments.commit"),
  resolveForServing: () => unexpected("Attachments.resolveForServing"),
  reconcileTicket: () => Effect.void,
  orphanProject: () => unexpected("Attachments.orphanProject"),
  listForOrg: () => unexpected("Attachments.listForOrg"),
  summarizeForOrg: () => unexpected("Attachments.summarizeForOrg"),
  deleteForOrg: () => unexpected("Attachments.deleteForOrg"),
  missingIds: () => Effect.succeed([]),
  reapOnce: () => unexpected("Attachments.reapOnce"),
  dedupeOnce: () => unexpected("Attachments.dedupeOnce")
} satisfies AttachmentsShape)

const FakeDb = Layer.succeed(Db, {
  query: {
    projectIndex: {
      findFirst: () => Effect.succeed({ id: "project-1" })
    },
    projectStatus: {
      findMany: () =>
        Effect.succeed([
          { slug: "todo" },
          { slug: "in_progress" },
          { slug: "done" }
        ])
    }
  }
} as never)

const TestLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const tmpRoot = yield* fs.makeTempDirectoryScoped({
      prefix: "projectproject-tk-"
    })
    return TicketsLive.pipe(
      Layer.provide(TicketDocsLive),
      Layer.provide(FakeAttachments),
      Layer.provide(FakeProjects),
      Layer.provide(FakeGroups),
      Layer.provide(FakeComments),
      Layer.provide(FakeGitHub),
      Layer.provide(FakeTicketIndex),
      Layer.provide(FakeDb),
      Layer.provide(TicketDocumentLock.layer),
      Layer.provide(MarkdownLive),
      Layer.provideMerge(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ PROJECTS_DIR: tmpRoot })
        )
      )
    )
  })
).pipe(Layer.provideMerge(BunServices.layer))

it.effect("deleting a ticket removes its markdown file from disk", () =>
  Effect.gen(function* () {
    const tickets = yield* Tickets
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* Config.string("PROJECTS_DIR")

    const created = yield* tickets.quickCreate("org", "user-1", "p", {
      title: "first"
    })
    expect(created.id).toBe("T-1")
    yield* tickets.update("org", "user-1", "p", created.id, {
      body: "# first\n\nimportant context only this ticket should know."
    })

    const filePath = path.join(
      root,
      "orgs",
      "org",
      "projects",
      "p",
      "tickets",
      "T-1.md"
    )
    expect(yield* fs.exists(filePath)).toBe(true)

    yield* tickets.remove("org", "user-1", "p", created.id)

    expect(yield* fs.exists(filePath)).toBe(false)
  }).pipe(Effect.provide(TestLayer))
)

it.effect("honors a custom status on quickCreate", () =>
  Effect.gen(function* () {
    const tickets = yield* Tickets
    const created = yield* tickets.quickCreate("org", "user-1", "p", {
      title: "in progress at birth",
      status: "in_progress" as TicketStatus
    })
    expect(created.status).toBe("in_progress")
  }).pipe(Effect.provide(TestLayer))
)

it.effect("falls back to 'todo' when status is omitted on quickCreate", () =>
  Effect.gen(function* () {
    const tickets = yield* Tickets
    const created = yield* tickets.quickCreate("org", "user-1", "p", {
      title: "no status given"
    })
    expect(created.status).toBe("todo")
  }).pipe(Effect.provide(TestLayer))
)

it.effect("rejects an unknown status on quickCreate", () =>
  Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* Effect.result(
      tickets.quickCreate("org", "user-1", "p", {
        title: "bogus",
        status: "not_a_real_status" as never
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(Effect.provide(TestLayer))
)

it.effect("archiving sets archivedAt and records the reason as a comment", () =>
  Effect.gen(function* () {
    recordedCommentBodies.length = 0
    const tickets = yield* Tickets
    const created = yield* tickets.quickCreate("org", "user-1", "p", {
      title: "archive me"
    })
    expect(created.archivedAt).toBeNull()

    const archived = yield* tickets.archive(
      "org",
      "user-1",
      "p",
      created.id,
      "no longer relevant"
    )
    expect(archived.archivedAt).not.toBeNull()
    expect(recordedCommentBodies).toEqual(["no longer relevant"])

    const unarchived = yield* tickets.unarchive(
      "org",
      "user-1",
      "p",
      created.id
    )
    expect(unarchived.archivedAt).toBeNull()
  }).pipe(Effect.provide(TestLayer))
)

it.effect("archiving without a reason posts no comment", () =>
  Effect.gen(function* () {
    recordedCommentBodies.length = 0
    const tickets = yield* Tickets
    const created = yield* tickets.quickCreate("org", "user-1", "p", {
      title: "silent archive"
    })
    yield* tickets.archive("org", "user-1", "p", created.id, "   ")
    expect(recordedCommentBodies).toEqual([])
  }).pipe(Effect.provide(TestLayer))
)

it.effect(
  "creating a ticket after deleting one with the same name does not inherit the old description",
  () =>
    Effect.gen(function* () {
      const tickets = yield* Tickets

      const original = yield* tickets.quickCreate("org", "user-1", "p", {
        title: "foo"
      })
      yield* tickets.update("org", "user-1", "p", original.id, {
        body: "# foo\n\nold secret description"
      })
      yield* tickets.remove("org", "user-1", "p", original.id)

      const reborn = yield* tickets.quickCreate("org", "user-1", "p", {
        title: "foo"
      })
      const fetched = yield* tickets.get("org", "user-1", "p", reborn.id)

      expect(fetched.body).not.toContain("old secret description")
      expect(fetched.body.trim()).toBe("")
    }).pipe(Effect.provide(TestLayer))
)

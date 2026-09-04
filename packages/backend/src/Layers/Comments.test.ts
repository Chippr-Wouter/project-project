import { it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { expect } from "vitest"
import { TicketId, TicketStatus } from "@projectproject/shared"
import { parseCommentsRegion } from "../comments-region"
import { Comments } from "../Services/Comments"
import { Db } from "../Services/Db"
import { Projects, type ProjectsShape } from "../Services/Projects"
import { TicketIndex, type TicketIndexShape } from "../Services/TicketIndex"
import {
  MalformedTicketDocument,
  TicketDocs,
  type TicketDocsShape,
  type TicketDocument
} from "../Services/TicketDocs"
import { Users, type UsersShape } from "../Services/Users"
import { CommentsLive } from "./Comments"

const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)
const at = (value: string) => DateTime.toDate(DateTime.unsafeMake(value))

const unexpected = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`unexpected ${method} call`))

const document: TicketDocument = {
  id: ticketId("T-1"),
  title: "Comments",
  status: ticketStatus("todo"),
  type: "chore",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  assignees: [],
  archivedAt: null,
  createdBy: "user-1",
  createdAt: at("2026-01-01T00:00:00.000Z"),
  updatedAt: at("2026-01-01T00:00:00.000Z"),
  body: "# Comments\n",
  commentsRegion: ""
}

const FakeProjects = Layer.succeed(Projects, {
  list: () => unexpected("Projects.list"),
  listPaged: () => unexpected("Projects.listPaged"),
  listMembersPaged: () => unexpected("Projects.listMembersPaged"),
  create: () => unexpected("Projects.create"),
  get: () => unexpected("Projects.get"),
  getKey: () => unexpected("Projects.getKey"),
  getGithubIntegration: () => unexpected("Projects.getGithubIntegration"),
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

const FakeTicketIndex = Layer.succeed(TicketIndex, {
  projectFor: () => unexpected("TicketIndex.projectFor"),
  list: () => unexpected("TicketIndex.list"),
  listIds: () => unexpected("TicketIndex.listIds"),
  existingIds: () => unexpected("TicketIndex.existingIds"),
  reserveTicketNumber: () => unexpected("TicketIndex.reserveTicketNumber"),
  tagUsageCounts: () => unexpected("TicketIndex.tagUsageCounts"),
  findTicketIdsByTag: () => unexpected("TicketIndex.findTicketIdsByTag"),
  findTicketIdsByStatus: () => unexpected("TicketIndex.findTicketIdsByStatus"),
  findTicketsByBranch: () => unexpected("TicketIndex.findTicketsByBranch"),
  upsertTicket: () => unexpected("TicketIndex.upsertTicket"),
  markBranchStale: () => unexpected("TicketIndex.markBranchStale"),
  clearBranchStale: () => unexpected("TicketIndex.clearBranchStale"),
  updateBranchChecks: () => unexpected("TicketIndex.updateBranchChecks"),
  deleteTicket: () => unexpected("TicketIndex.deleteTicket"),
  rebuildProject: () => unexpected("TicketIndex.rebuildProject"),
  rebuildAllProjects: () => unexpected("TicketIndex.rebuildAllProjects"),
  reconcileProject: () => unexpected("TicketIndex.reconcileProject"),
  reconcileAllProjects: () => unexpected("TicketIndex.reconcileAllProjects")
} satisfies TicketIndexShape)

const author = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  username: "user",
  image: null,
  createdAt: at("2026-01-01T00:00:00.000Z"),
  activeOrgSlug: "org",
  personalGithub: { connected: false },
  editorPreference: "github" as const,
  personalEverhour: {
    connected: false,
    everhourUserId: null,
    name: null,
    email: null,
    lastVerifiedAt: null,
    lastCheckError: null
  }
}

const FakeUsers = Layer.succeed(Users, {
  findByEmail: () => unexpected("Users.findByEmail"),
  findManyByIds: () => unexpected("Users.findManyByIds"),
  fullByIds: () => Effect.succeed([author])
} satisfies UsersShape)

const FakeDb = Layer.succeed(Db, {
  insert: () => ({ values: () => Effect.void }),
  delete: () => ({ where: () => Effect.void })
} as never)

const makeLayer = (ticketDocs: TicketDocsShape) =>
  CommentsLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(TicketDocs, ticketDocs),
        FakeProjects,
        FakeTicketIndex,
        FakeUsers,
        FakeDb
      )
    )
  )

const makeTicketDocs = (
  overrides: Partial<TicketDocsShape> = {}
): TicketDocsShape => {
  const service: TicketDocsShape = {
    listIds: () => unexpected("TicketDocs.listIds"),
    read: () => Effect.succeed(document),
    create: () => unexpected("TicketDocs.create"),
    write: () => unexpected("TicketDocs.write"),
    update: (orgSlug, slug, id, transform) =>
      service.read(orgSlug, slug, id).pipe(Effect.flatMap(transform)),
    remove: () => unexpected("TicketDocs.remove"),
    readRaw: () => unexpected("TicketDocs.readRaw"),
    ...overrides
  }
  return service
}

it.effect("creates comments through TicketDocs", () => {
  let written: TicketDocument | undefined
  const layer = makeLayer(
    makeTicketDocs({
      update: (_orgSlug, _slug, _ticketId, transform) =>
        transform(document).pipe(
          Effect.tap((next) =>
            Effect.sync(() => {
              written = next
            })
          )
        ),
    })
  )

  return Effect.gen(function* () {
    const comments = yield* Comments
    const created = yield* comments.create(
      "org",
      "user-1",
      "project",
      ticketId("T-1"),
      {
        body: "A useful comment"
      }
    )

    expect(created.author).toEqual(author)
    expect(written?.body).toBe(document.body)
    expect(parseCommentsRegion(written?.commentsRegion ?? "")).toMatchObject([
      { author: "user-1", body: "A useful comment" }
    ])
  }).pipe(Effect.provide(layer))
})

it.effect("keeps malformed ticket documents in the typed error channel", () => {
  const malformed = new MalformedTicketDocument({
    orgSlug: "org",
    slug: "project",
    ticketId: "T-1",
    path: "orgs/org/projects/project/tickets/T-1.md",
    reason: "invalid_frontmatter",
    cause: new Error("invalid frontmatter")
  })
  const layer = makeLayer(
    makeTicketDocs({ update: () => Effect.fail(malformed) })
  )

  return Effect.gen(function* () {
    const comments = yield* Comments
    const error = yield* Effect.flip(
      comments.create("org", "user-1", "project", ticketId("T-1"), {
        body: "A useful comment"
      })
    )

    expect(error).toBe(malformed)
  }).pipe(Effect.provide(layer))
})

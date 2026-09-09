import { it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as TestClock from "effect/testing/TestClock"
import { expect } from "vite-plus/test"
import {
  Forbidden,
  GroupId,
  NotFound,
  ProjectColor,
  ProjectIcon,
  ProjectKey,
  TicketId,
  TicketStatus
} from "@projectproject/shared"
import type { GroupDetail, ProjectDetail, Role } from "@projectproject/shared"
import { GroupDocs, type GroupDocsShape, type GroupDocument } from "./GroupDocs"
import { Groups } from "./Groups"
import { GroupsLive } from "../Layers/Groups"
import { GroupIdTaken } from "./Markdown"
import { Projects, type ProjectsShape } from "./Projects"
import { TicketIndex, type TicketIndexShape } from "./TicketIndex"
import {
  TicketDocs,
  type TicketDocsShape,
  type TicketDocument
} from "./TicketDocs"
import * as TicketDocumentLock from "../ticketDocumentLock"

const isoDate = (s: string) => DateTime.toDate(DateTime.makeUnsafe(s))
const setTestNow = TestClock.setTime(
  DateTime.toEpochMillis(DateTime.makeUnsafe("2026-05-19T00:00:00.000Z"))
)

const groupId = Schema.decodeUnknownSync(GroupId)
const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)
const projectKey = Schema.decodeUnknownSync(ProjectKey)
const projectIcon = Schema.decodeUnknownSync(ProjectIcon)
const projectColor = Schema.decodeUnknownSync(ProjectColor)

function unexpectedTicketDocsCall(method: string): Effect.Effect<never> {
  return Effect.die(new Error(`unexpected TicketDocs.${method} call`))
}

const defaultTicketStatus = ticketStatus("todo")

function makeTicketDocument(
  id: string,
  status: TicketStatus = defaultTicketStatus
): TicketDocument {
  const now = isoDate("2026-04-01T00:00:00.000Z")
  return {
    id: ticketId(id),
    title: id,
    status,
    type: "other",
    priority: "med",
    tags: [],
    branch: null,
    pr: null,
    prState: null,
    lastTransitionedPr: null,
    assignees: [],
    archivedAt: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    body: "",
    commentsRegion: ""
  }
}

function ticketIndexEntryFromDocument(ticket: TicketDocument) {
  const { body: _body, commentsRegion: _commentsRegion, ...entry } = ticket
  return {
    ...entry,
    branchDeletedAt: null,
    checks: null,
    checksHeadSha: null,
    checksUpdatedAt: null
  }
}

function makeFakeDocs(initial?: {
  ticketIds?: ReadonlyArray<string>
  ticketStatuses?: Record<string, TicketStatus>
  groups?: Record<string, GroupDetail>
}) {
  const groups = new Map<string, GroupDocument>(
    Object.entries(initial?.groups ?? {})
  )
  const ticketIds = [...(initial?.ticketIds ?? [])]
  const ticketsById = new Map<string, TicketDocument>(
    ticketIds.map((id) => [
      id,
      makeTicketDocument(
        id,
        initial?.ticketStatuses?.[id] ?? defaultTicketStatus
      )
    ])
  )

  const groupWrites: Array<{ id: string }> = []

  const groupService = {
    listIds: () => Effect.succeed([...groups.keys()].map((id) => groupId(id))),
    read: (_org: string, _slug: string, id: string) => {
      const group = groups.get(id)
      return group ? Effect.succeed(group) : Effect.fail(new NotFound())
    },
    create: (_org: string, _slug: string, document: GroupDocument) => {
      if (groups.has(document.id)) {
        return Effect.fail(new GroupIdTaken())
      }
      groups.set(document.id, document)
      return Effect.void
    },
    write: (
      _org: string,
      _slug: string,
      id: string,
      document: GroupDocument
    ) => {
      groupWrites.push({ id })
      groups.set(id, document)
      return Effect.void
    },
    writeIfExists: (
      _org: string,
      _slug: string,
      id: string,
      document: GroupDocument
    ) => {
      if (!groups.has(id)) return Effect.fail(new NotFound())
      groupWrites.push({ id })
      groups.set(id, document)
      return Effect.void
    },
    remove: (_org: string, _slug: string, id: string) => {
      if (!groups.has(id)) return Effect.fail(new NotFound())
      groups.delete(id)
      return Effect.void
    },
    readRaw: () => Effect.die(new Error("unexpected GroupDocs.readRaw call"))
  } satisfies GroupDocsShape

  const ticketService: TicketDocsShape = {
    listIds: () =>
      Effect.succeed([...ticketsById.keys()].map((id) => ticketId(id))),
    read: (_org: string, _slug: string, id: string) => {
      const ticket = ticketsById.get(id)
      return ticket ? Effect.succeed(ticket) : Effect.fail(new NotFound())
    },
    create: () => unexpectedTicketDocsCall("create"),
    write: (
      _org: string,
      _slug: string,
      id: string,
      document: TicketDocument
    ) => {
      ticketsById.set(id, document)
      return Effect.void
    },
    update: (org: string, slug: string, id: string, transform, onPersist) =>
      ticketService.read(org, slug, id).pipe(
        Effect.flatMap(transform),
        Effect.tap((document) =>
          Effect.sync(() => ticketsById.set(id, document))
        ),
        Effect.tap((document) =>
          onPersist ? onPersist(document) : Effect.void
        )
      ),
    remove: () => unexpectedTicketDocsCall("remove"),
    readRaw: () => unexpectedTicketDocsCall("readRaw")
  }

  const indexProject = {
    orgSlug: "org",
    organizationId: "org-1",
    projectId: "project-1",
    projectSlug: "p"
  }

  const ticketIndexService = {
    projectFor: () => Effect.succeed(indexProject),
    list: (_project, requestedIds) =>
      Effect.sync(() => {
        const requested =
          requestedIds === undefined ? null : new Set(requestedIds)
        return [...ticketsById.values()]
          .filter((ticket) => requested === null || requested.has(ticket.id))
          .map(ticketIndexEntryFromDocument)
      }),
    query: () => Effect.die(new Error("unexpected TicketIndex.query")),
    count: () => Effect.die(new Error("unexpected TicketIndex.count")),
    listIds: () => Effect.succeed([...ticketsById.keys()]),
    existingIds: (_project, ticketIds) =>
      Effect.succeed(
        new Set(ticketIds.filter((ticketId) => ticketsById.has(ticketId)))
      ),
    reserveTicketNumber: () =>
      Effect.sync(
        () =>
          Math.max(
            0,
            ...[...ticketsById.keys()].map((id) => Number(id.slice(2)))
          ) + 1
      ),
    tagUsageCounts: () => Effect.succeed({}),
    findTicketIdsByTag: () => Effect.succeed([]),
    findTicketIdsByStatus: () => Effect.succeed([]),
    findTicketsByBranch: () => Effect.succeed([]),
    isRepositoryBranchAttached: () => Effect.succeed(false),
    getBranchDeletedAt: () => Effect.succeed(null),
    upsertTicket: (_project, document) =>
      Effect.sync(() => {
        ticketsById.set(document.id, document)
      }),
    markBranchStale: () => Effect.succeed([]),
    clearBranchStale: () => Effect.void,
    updateBranchChecks: () => Effect.succeed([]),
    deleteTicket: (_project, id) =>
      Effect.sync(() => {
        ticketsById.delete(id)
      }),
    rebuildProject: () =>
      Effect.succeed({
        project: indexProject,
        indexed: ticketsById.size,
        skipped: 0
      }),
    rebuildAllProjects: () => Effect.succeed({ projects: [] }),
    reconcileProject: () =>
      Effect.succeed({
        project: indexProject,
        drift: { missing: [], orphaned: [], stale: [] },
        rebuilt: false,
        indexed: ticketsById.size,
        skipped: 0
      }),
    reconcileAllProjects: () => Effect.succeed({ projects: [], reconciled: 0 })
  } satisfies TicketIndexShape

  return {
    state: { groups, ticketIds, ticketsById, groupWrites },
    groupLayer: Layer.succeed(GroupDocs, groupService),
    ticketLayer: Layer.succeed(TicketDocs, ticketService),
    ticketIndexLayer: Layer.succeed(TicketIndex, ticketIndexService)
  }
}

function makeProjectDetail(role: Role): ProjectDetail {
  return {
    org: "org",
    slug: "p",
    key: projectKey("FOO"),
    name: "Project",
    icon: projectIcon("🚀"),
    color: projectColor("#53a0ff"),
    createdBy: "user-1",
    createdAt: isoDate("2026-01-01T00:00:00.000Z"),
    github: null,
    setup: {
      workflowReviewedAt: null,
      invitePeopleDismissedAt: null,
      connectGithubDismissedAt: null
    },
    body: "# Project\n",
    members: [
      {
        id: "user-1",
        username: null,
        name: "User One",
        email: "user@example.com",
        image: null,
        role
      }
    ],
    pendingMembers: []
  }
}

function unexpectedProjectCall(method: string): Effect.Effect<never> {
  return Effect.die(new Error(`unexpected Projects.${method} call`))
}

function makeFakeProjects(opts: { role?: Role } = {}) {
  const role = opts.role ?? "member"
  const service = {
    list: () => Effect.succeed([]),
    listPaged: () => unexpectedProjectCall("listPaged"),
    listMembersPaged: () => unexpectedProjectCall("listMembersPaged"),
    create: () => unexpectedProjectCall("create"),
    getKey: () => unexpectedProjectCall("getKey"),
    getGithubIntegration: () => unexpectedProjectCall("getGithubIntegration"),
    requireMember: () => Effect.succeed({ role }),
    requireRole: (
      _org: string,
      _userId: string,
      _slug: string,
      allowed: ReadonlyArray<Role>
    ) =>
      allowed.includes(role)
        ? Effect.succeed({ role })
        : Effect.fail(new Forbidden()),
    get: () => Effect.succeed(makeProjectDetail(role)),
    update: () => unexpectedProjectCall("update"),
    updateSetup: () => unexpectedProjectCall("updateSetup"),
    remove: () => unexpectedProjectCall("remove"),
    addMember: () => unexpectedProjectCall("addMember"),
    updateMember: () => unexpectedProjectCall("updateMember"),
    transferOwnership: () => unexpectedProjectCall("transferOwnership"),
    removeMember: () => unexpectedProjectCall("removeMember"),
    cancelPendingMember: () => unexpectedProjectCall("cancelPendingMember"),
    unassignUserFromActiveTickets: () =>
      unexpectedProjectCall("unassignUserFromActiveTickets"),
    connectGithub: () => unexpectedProjectCall("connectGithub"),
    disconnectGithub: () => unexpectedProjectCall("disconnectGithub")
  } satisfies ProjectsShape

  return Layer.succeed(Projects, service)
}

function makeGroupsLayer(
  docs?: Parameters<typeof makeFakeDocs>[0],
  projects?: { role?: Role }
) {
  const fakeDocs = makeFakeDocs(docs)
  return GroupsLive.pipe(
    Layer.provide(fakeDocs.groupLayer),
    Layer.provide(fakeDocs.ticketLayer),
    Layer.provide(fakeDocs.ticketIndexLayer),
    Layer.provide(makeFakeProjects(projects)),
    Layer.provide(TicketDocumentLock.layer)
  )
}

it.effect("create + list returns the new group", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "Backlog cleanup"
    })
    expect(created.id).toBe("G-1")
    expect(created.kind).toBe("other")

    const list = yield* groups.list("org", "user-1", "p")
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe("Backlog cleanup")
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect("create with kind=sprint fails for non-admin member", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const result = yield* Effect.result(
      groups.create("org", "user-1", "p", {
        name: "Sprint 1",
        kind: "sprint"
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Forbidden")
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect("create with kind=sprint succeeds for admin", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "Sprint 1",
      kind: "sprint"
    })
    expect(created.kind).toBe("sprint")
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "admin" })))
)

it.effect("updateTickets rejects unknown ticket ids", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G"
    })
    const result = yield* Effect.result(
      groups.updateTickets("org", "user-1", "p", created.id, {
        tickets: [ticketId("T-99")]
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NotFound")
    }
  }).pipe(
    Effect.provide(makeGroupsLayer({ ticketIds: ["T-1"] }, { role: "member" }))
  )
)

it.effect("updateTickets returns NotFound before validating tickets", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const result = yield* Effect.result(
      groups.updateTickets("org", "user-1", "p", "G-404", {
        tickets: [ticketId("T-99")]
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NotFound")
    }
  }).pipe(
    Effect.provide(makeGroupsLayer({ ticketIds: ["T-1"] }, { role: "member" }))
  )
)

it.effect("create rejects endsAt before startsAt", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const result = yield* Effect.result(
      groups.create("org", "user-1", "p", {
        name: "G",
        startsAt: isoDate("2026-06-01"),
        endsAt: isoDate("2026-05-01")
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect("update rejects endsAt before existing startsAt", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      startsAt: isoDate("2026-06-01"),
      endsAt: isoDate("2026-07-01")
    })
    const result = yield* Effect.result(
      groups.update("org", "user-1", "p", created.id, {
        endsAt: isoDate("2026-05-15")
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect("update rejects completedAt in the future", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", { name: "G" })
    const future = DateTime.toDate(
      DateTime.add(DateTime.nowUnsafe(), { days: 1 })
    )
    const result = yield* Effect.result(
      groups.update("org", "user-1", "p", created.id, {
        completedAt: future
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect("update rejects completedAt before startsAt", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      startsAt: isoDate("2026-04-01"),
      endsAt: isoDate("2026-04-30")
    })
    const result = yield* Effect.result(
      groups.update("org", "user-1", "p", created.id, {
        completedAt: isoDate("2026-03-01")
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect(
  "updateTickets against a sprint auto-evicts overlapping ids from other non-completed sprints",
  () =>
    Effect.gen(function* () {
      const groups = yield* Groups
      const sprintA = yield* groups.create("org", "user-1", "p", {
        name: "Sprint A",
        kind: "sprint",
        tickets: [ticketId("T-1"), ticketId("T-2")]
      })
      const sprintB = yield* groups.create("org", "user-1", "p", {
        name: "Sprint B",
        kind: "sprint"
      })
      const epic = yield* groups.create("org", "user-1", "p", {
        name: "Epic",
        tickets: [ticketId("T-1")]
      })

      const result = yield* groups.updateTickets(
        "org",
        "user-1",
        "p",
        sprintB.id,
        { tickets: [ticketId("T-1")] }
      )

      expect(result.target.id).toBe(sprintB.id)
      expect(result.target.tickets).toEqual(["T-1"])
      expect(result.evicted).toHaveLength(1)
      expect(result.evicted[0].groupId).toBe(sprintA.id)
      expect(result.evicted[0].ticketIds).toEqual(["T-1"])

      const sprintAAfter = yield* groups.get("org", "user-1", "p", sprintA.id)
      expect(sprintAAfter.tickets).toEqual(["T-2"])

      const epicAfter = yield* groups.get("org", "user-1", "p", epic.id)
      expect(epicAfter.tickets).toEqual(["T-1"])
    }).pipe(
      Effect.provide(
        makeGroupsLayer({ ticketIds: ["T-1", "T-2"] }, { role: "admin" })
      )
    )
)

it.effect(
  "updateTickets against a completed sprint fails with SprintCompletedImmutable",
  () =>
    Effect.gen(function* () {
      yield* setTestNow
      const groups = yield* Groups
      const sprint = yield* groups.create("org", "user-1", "p", {
        name: "Sprint",
        kind: "sprint",
        startsAt: isoDate("2026-04-01"),
        endsAt: isoDate("2026-04-15")
      })
      yield* groups.update("org", "user-1", "p", sprint.id, {
        completedAt: isoDate("2026-04-15")
      })
      const result = yield* Effect.result(
        groups.updateTickets("org", "user-1", "p", sprint.id, {
          tickets: [ticketId("T-1")]
        })
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("SprintCompletedImmutable")
      }
    }).pipe(
      Effect.provide(makeGroupsLayer({ ticketIds: ["T-1"] }, { role: "admin" }))
    )
)

it.effect(
  "updateTickets against a sprint does not evict from completed sprints",
  () =>
    Effect.gen(function* () {
      yield* setTestNow
      const groups = yield* Groups
      const completed = yield* groups.create("org", "user-1", "p", {
        name: "Completed",
        kind: "sprint",
        startsAt: isoDate("2026-03-01"),
        endsAt: isoDate("2026-03-15"),
        tickets: [ticketId("T-1")]
      })
      yield* groups.update("org", "user-1", "p", completed.id, {
        completedAt: isoDate("2026-03-15")
      })
      const active = yield* groups.create("org", "user-1", "p", {
        name: "Active",
        kind: "sprint"
      })

      const result = yield* groups.updateTickets(
        "org",
        "user-1",
        "p",
        active.id,
        { tickets: [ticketId("T-1")] }
      )

      expect(result.evicted).toHaveLength(0)
      const completedAfter = yield* groups.get(
        "org",
        "user-1",
        "p",
        completed.id
      )
      expect(completedAfter.tickets).toEqual(["T-1"])
    }).pipe(
      Effect.provide(makeGroupsLayer({ ticketIds: ["T-1"] }, { role: "admin" }))
    )
)

it.effect(
  "complete to backlog: 'done' tickets stay, others fall off the source",
  () =>
    Effect.gen(function* () {
      yield* setTestNow
      const groups = yield* Groups
      const sprint = yield* groups.create("org", "user-1", "p", {
        name: "Sprint",
        kind: "sprint",
        startsAt: isoDate("2026-03-01"),
        endsAt: isoDate("2026-03-15"),
        tickets: [ticketId("T-1"), ticketId("T-2"), ticketId("T-3")]
      })

      const result = yield* groups.complete("org", "user-1", "p", sprint.id, {
        destination: { kind: "backlog" }
      })

      expect(result.completedAt).not.toBeNull()
      expect(result.tickets).toEqual(["T-2"])
    }).pipe(
      Effect.provide(
        makeGroupsLayer(
          {
            ticketIds: ["T-1", "T-2", "T-3"],
            ticketStatuses: {
              "T-1": ticketStatus("todo"),
              "T-2": ticketStatus("done"),
              "T-3": ticketStatus("in_progress")
            }
          },
          { role: "admin" }
        )
      )
    )
)

it.effect(
  "complete to sprint: carryover tickets land on the destination, deduped",
  () =>
    Effect.gen(function* () {
      yield* setTestNow
      const groups = yield* Groups
      const source = yield* groups.create("org", "user-1", "p", {
        name: "Source",
        kind: "sprint",
        startsAt: isoDate("2026-03-01"),
        endsAt: isoDate("2026-03-15"),
        tickets: [ticketId("T-1"), ticketId("T-2"), ticketId("T-3")]
      })
      const dest = yield* groups.create("org", "user-1", "p", {
        name: "Dest",
        kind: "sprint",
        startsAt: isoDate("2026-03-15"),
        endsAt: isoDate("2026-03-29"),
        tickets: [ticketId("T-3"), ticketId("T-4")]
      })

      yield* groups.complete("org", "user-1", "p", source.id, {
        destination: { kind: "sprint", groupId: dest.id }
      })

      const sourceAfter = yield* groups.get("org", "user-1", "p", source.id)
      expect(sourceAfter.tickets).toEqual(["T-2"])
      expect(sourceAfter.completedAt).not.toBeNull()

      const destAfter = yield* groups.get("org", "user-1", "p", dest.id)
      expect(destAfter.tickets).toEqual(["T-3", "T-4", "T-1"])
      expect(destAfter.completedAt).toBeNull()
    }).pipe(
      Effect.provide(
        makeGroupsLayer(
          {
            ticketIds: ["T-1", "T-2", "T-3", "T-4"],
            ticketStatuses: {
              "T-1": ticketStatus("todo"),
              "T-2": ticketStatus("done"),
              "T-3": ticketStatus("in_progress"),
              "T-4": ticketStatus("todo")
            }
          },
          { role: "admin" }
        )
      )
    )
)

it.effect(
  "complete on an already-completed sprint fails with SprintCompletedImmutable",
  () =>
    Effect.gen(function* () {
      yield* setTestNow
      const groups = yield* Groups
      const sprint = yield* groups.create("org", "user-1", "p", {
        name: "Sprint",
        kind: "sprint",
        startsAt: isoDate("2026-03-01"),
        endsAt: isoDate("2026-03-15")
      })
      yield* groups.update("org", "user-1", "p", sprint.id, {
        completedAt: isoDate("2026-03-15")
      })

      const result = yield* Effect.result(
        groups.complete("org", "user-1", "p", sprint.id, {
          destination: { kind: "backlog" }
        })
      )

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("SprintCompletedImmutable")
      }
    }).pipe(
      Effect.provide(makeGroupsLayer({ ticketIds: [] }, { role: "admin" }))
    )
)

it.effect(
  "complete fails with SprintCompletedImmutable when destination is already completed",
  () =>
    Effect.gen(function* () {
      yield* setTestNow
      const groups = yield* Groups
      const source = yield* groups.create("org", "user-1", "p", {
        name: "Source",
        kind: "sprint",
        startsAt: isoDate("2026-03-01"),
        endsAt: isoDate("2026-03-15")
      })
      const dest = yield* groups.create("org", "user-1", "p", {
        name: "Dest",
        kind: "sprint",
        startsAt: isoDate("2026-03-15"),
        endsAt: isoDate("2026-03-29")
      })
      yield* groups.update("org", "user-1", "p", dest.id, {
        completedAt: isoDate("2026-03-29")
      })

      const result = yield* Effect.result(
        groups.complete("org", "user-1", "p", source.id, {
          destination: { kind: "sprint", groupId: dest.id }
        })
      )

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("SprintCompletedImmutable")
      }
    }).pipe(
      Effect.provide(makeGroupsLayer({ ticketIds: [] }, { role: "admin" }))
    )
)

it.effect("complete fails with Validation when source is not a sprint", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const epic = yield* groups.create("org", "user-1", "p", {
      name: "Epic",
      kind: "epic"
    })

    const result = yield* Effect.result(
      groups.complete("org", "user-1", "p", epic.id, {
        destination: { kind: "backlog" }
      })
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "admin" })))
)

it.effect(
  "complete fails with Validation when destination is not a sprint",
  () =>
    Effect.gen(function* () {
      const groups = yield* Groups
      const source = yield* groups.create("org", "user-1", "p", {
        name: "Source",
        kind: "sprint",
        startsAt: isoDate("2026-03-01"),
        endsAt: isoDate("2026-03-15")
      })
      const epic = yield* groups.create("org", "user-1", "p", {
        name: "Epic",
        kind: "epic"
      })

      const result = yield* Effect.result(
        groups.complete("org", "user-1", "p", source.id, {
          destination: { kind: "sprint", groupId: epic.id }
        })
      )

      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("Validation")
      }
    }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "admin" })))
)

it.effect("complete fails for non-admin members", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const result = yield* Effect.result(
      groups.complete("org", "user-1", "p", "G-1", {
        destination: { kind: "backlog" }
      })
    )

    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(["Forbidden", "NotFound"]).toContain(result.failure._tag)
    }
  }).pipe(Effect.provide(makeGroupsLayer(undefined, { role: "member" })))
)

it.effect("updateTicketOrder reorders within the same status", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      tickets: [ticketId("T-1"), ticketId("T-2"), ticketId("T-3")]
    })
    const updated = yield* groups.updateTicketOrder(
      "org",
      "user-1",
      "p",
      created.id,
      { ticketId: ticketId("T-1"), after: ticketId("T-2") }
    )
    expect(updated.tickets).toEqual(["T-2", "T-1", "T-3"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2", "T-3"] }, { role: "member" })
    )
  )
)

it.effect("updateTicketOrder places at the start when after is null", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      tickets: [ticketId("T-1"), ticketId("T-2"), ticketId("T-3")]
    })
    const updated = yield* groups.updateTicketOrder(
      "org",
      "user-1",
      "p",
      created.id,
      { ticketId: ticketId("T-3"), after: null }
    )
    expect(updated.tickets).toEqual(["T-3", "T-1", "T-2"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2", "T-3"] }, { role: "member" })
    )
  )
)

it.effect("updateTicketOrder patches ticket status when provided", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      tickets: [ticketId("T-1"), ticketId("T-2")]
    })
    const updated = yield* groups.updateTicketOrder(
      "org",
      "user-1",
      "p",
      created.id,
      {
        ticketId: ticketId("T-1"),
        status: ticketStatus("in_progress"),
        after: ticketId("T-2")
      }
    )
    expect(updated.tickets).toEqual(["T-2", "T-1"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          ticketIds: ["T-1", "T-2"],
          ticketStatuses: {
            "T-1": ticketStatus("todo"),
            "T-2": ticketStatus("in_progress")
          }
        },
        { role: "member" }
      )
    )
  )
)

it.effect("updateTicketOrder rejects when ticket is not in the group", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      tickets: [ticketId("T-1")]
    })
    const result = yield* Effect.result(
      groups.updateTicketOrder("org", "user-1", "p", created.id, {
        ticketId: ticketId("T-2"),
        after: null
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NotFound")
    }
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2"] }, { role: "member" })
    )
  )
)

it.effect("updateTicketOrder rejects when after refers to itself", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      tickets: [ticketId("T-1"), ticketId("T-2")]
    })
    const result = yield* Effect.result(
      groups.updateTicketOrder("org", "user-1", "p", created.id, {
        ticketId: ticketId("T-1"),
        after: ticketId("T-1")
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Validation")
    }
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2"] }, { role: "member" })
    )
  )
)

it.effect("updateTicketOrder rejects on completed sprint", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "S",
      kind: "sprint",
      tickets: [ticketId("T-1"), ticketId("T-2")]
    })
    yield* groups.complete("org", "user-1", "p", created.id, {
      destination: { kind: "backlog" }
    })
    const result = yield* Effect.result(
      groups.updateTicketOrder("org", "user-1", "p", created.id, {
        ticketId: ticketId("T-1"),
        after: null
      })
    )
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("SprintCompletedImmutable")
    }
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          ticketIds: ["T-1", "T-2"],
          ticketStatuses: {
            "T-1": ticketStatus("done"),
            "T-2": ticketStatus("done")
          }
        },
        { role: "admin" }
      )
    )
  )
)

function makeSprintDoc(
  id: string,
  overrides: Partial<GroupDocument> = {}
): GroupDocument {
  const now = isoDate("2026-05-01T00:00:00.000Z")
  return {
    id: groupId(id),
    name: id,
    kind: "sprint",
    tickets: [],
    color: "#abcdef" as GroupDocument["color"],
    startsAt: null,
    endsAt: null,
    completedAt: null,
    createdBy: "user-1",
    createdAt: now,
    updatedAt: now,
    body: "",
    ...overrides
  }
}

it.effect("listPaged filters by kind", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const page = yield* groups.listPaged(
      "org",
      "user-1",
      "p",
      { kind: ["sprint"] },
      undefined,
      50
    )
    expect(page.items.map((g) => g.id)).toEqual(["G-1", "G-3"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          groups: {
            "G-1": makeSprintDoc("G-1"),
            "G-2": makeSprintDoc("G-2", { kind: "epic" }),
            "G-3": makeSprintDoc("G-3")
          }
        },
        { role: "admin" }
      )
    )
  )
)

it.effect("listPaged active=true keeps only running sprints", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const page = yield* groups.listPaged(
      "org",
      "user-1",
      "p",
      { active: true },
      undefined,
      50
    )
    expect(page.items.map((g) => g.id)).toEqual(["G-1"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          groups: {
            "G-1": makeSprintDoc("G-1"),
            "G-2": makeSprintDoc("G-2", {
              completedAt: isoDate("2026-04-15T00:00:00.000Z")
            }),
            "G-3": makeSprintDoc("G-3", { kind: "epic" })
          }
        },
        { role: "admin" }
      )
    )
  )
)

it.effect("listSprintsPaged filters by state=active", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const page = yield* groups.listSprintsPaged(
      "org",
      "user-1",
      "p",
      "active",
      undefined,
      50
    )
    expect(page.items.map((g) => g.id)).toEqual(["G-1"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          groups: {
            "G-1": makeSprintDoc("G-1"),
            "G-2": makeSprintDoc("G-2", {
              completedAt: isoDate("2026-04-15T00:00:00.000Z")
            }),
            "G-3": makeSprintDoc("G-3", {
              startsAt: isoDate("2099-01-01T00:00:00.000Z")
            }),
            "G-4": makeSprintDoc("G-4", { kind: "epic" })
          }
        },
        { role: "admin" }
      )
    )
  )
)

it.effect("listSprintsPaged filters by state=completed", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const page = yield* groups.listSprintsPaged(
      "org",
      "user-1",
      "p",
      "completed",
      undefined,
      50
    )
    expect(page.items.map((g) => g.id)).toEqual(["G-2"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          groups: {
            "G-1": makeSprintDoc("G-1"),
            "G-2": makeSprintDoc("G-2", {
              completedAt: isoDate("2026-04-15T00:00:00.000Z")
            }),
            "G-3": makeSprintDoc("G-3", {
              startsAt: isoDate("2099-01-01T00:00:00.000Z")
            })
          }
        },
        { role: "admin" }
      )
    )
  )
)

it.effect("listSprintsPaged with no state returns all sprints, no epics", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const page = yield* groups.listSprintsPaged(
      "org",
      "user-1",
      "p",
      undefined,
      undefined,
      50
    )
    expect(page.items.map((g) => g.id)).toEqual(["G-1", "G-2"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer(
        {
          groups: {
            "G-1": makeSprintDoc("G-1"),
            "G-2": makeSprintDoc("G-2", {
              completedAt: isoDate("2026-04-15T00:00:00.000Z")
            }),
            "G-3": makeSprintDoc("G-3", { kind: "epic" })
          }
        },
        { role: "admin" }
      )
    )
  )
)

it.effect("removeTicketFromAllGroups strips the id", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "G",
      tickets: [ticketId("T-1"), ticketId("T-2")]
    })
    yield* groups.removeTicketFromAllGroups("org", "p", "T-1")
    const after = yield* groups.get("org", "user-1", "p", created.id)
    expect(after.tickets).toEqual(["T-2"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2"] }, { role: "member" })
    )
  )
)

it.effect(
  "addTickets appends novel ticket ids and preserves existing order",
  () =>
    Effect.gen(function* () {
      const groups = yield* Groups
      const created = yield* groups.create("org", "user-1", "p", {
        name: "Sprint 1",
        kind: "sprint",
        tickets: [ticketId("T-1")]
      })
      const result = yield* groups.addTickets(
        "org",
        "user-1",
        "p",
        created.id,
        [ticketId("T-2"), ticketId("T-3")]
      )
      expect(result.target.tickets).toEqual(["T-1", "T-2", "T-3"])
      expect(result.evicted).toEqual([])
    }).pipe(
      Effect.provide(
        makeGroupsLayer({ ticketIds: ["T-1", "T-2", "T-3"] }, { role: "admin" })
      )
    )
)

it.effect("addTickets deduplicates against current membership", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "Sprint 1",
      kind: "sprint",
      tickets: [ticketId("T-1"), ticketId("T-2")]
    })
    const result = yield* groups.addTickets("org", "user-1", "p", created.id, [
      ticketId("T-1"),
      ticketId("T-3")
    ])
    expect(result.target.tickets).toEqual(["T-1", "T-2", "T-3"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2", "T-3"] }, { role: "admin" })
    )
  )
)

it.effect("addTickets deduplicates within the request payload", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "Sprint 1",
      kind: "sprint",
      tickets: [ticketId("T-1")]
    })
    const result = yield* groups.addTickets("org", "user-1", "p", created.id, [
      ticketId("T-2"),
      ticketId("T-2"),
      ticketId("T-3"),
      ticketId("T-3"),
      ticketId("T-2")
    ])
    expect(result.target.tickets).toEqual(["T-1", "T-2", "T-3"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2", "T-3"] }, { role: "admin" })
    )
  )
)

it.effect(
  "addTickets is a no-op when nothing new is added — no group write happens",
  () => {
    const fakeDocs = makeFakeDocs({ ticketIds: ["T-1", "T-2"] })
    const layer = GroupsLive.pipe(
      Layer.provide(fakeDocs.groupLayer),
      Layer.provide(fakeDocs.ticketLayer),
      Layer.provide(fakeDocs.ticketIndexLayer),
      Layer.provide(makeFakeProjects({ role: "admin" })),
      Layer.provide(TicketDocumentLock.layer)
    )
    return Effect.gen(function* () {
      const groups = yield* Groups
      const created = yield* groups.create("org", "user-1", "p", {
        name: "Sprint 1",
        kind: "sprint",
        tickets: [ticketId("T-1"), ticketId("T-2")]
      })
      const writesAfterCreate = fakeDocs.state.groupWrites.length
      const result = yield* groups.addTickets(
        "org",
        "user-1",
        "p",
        created.id,
        [ticketId("T-1"), ticketId("T-2")]
      )
      expect(result.target.tickets).toEqual(["T-1", "T-2"])
      expect(result.evicted).toEqual([])
      expect(fakeDocs.state.groupWrites.length).toBe(writesAfterCreate)
    }).pipe(Effect.provide(layer))
  }
)

it.effect("addTickets evicts overlap from other active sprints", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const sprintA = yield* groups.create("org", "user-1", "p", {
      name: "Sprint A",
      kind: "sprint",
      tickets: [ticketId("T-1"), ticketId("T-2")]
    })
    const sprintB = yield* groups.create("org", "user-1", "p", {
      name: "Sprint B",
      kind: "sprint"
    })
    const result = yield* groups.addTickets("org", "user-1", "p", sprintB.id, [
      ticketId("T-2")
    ])
    expect(result.target.tickets).toEqual(["T-2"])
    expect(result.evicted).toEqual([
      { groupId: sprintA.id, ticketIds: ["T-2"] }
    ])
    const a = yield* groups.get("org", "user-1", "p", sprintA.id)
    expect(a.tickets).toEqual(["T-1"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2"] }, { role: "admin" })
    )
  )
)

it.effect("addTickets refuses to mutate a completed sprint", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const created = yield* groups.create("org", "user-1", "p", {
      name: "Sprint 1",
      kind: "sprint",
      tickets: [ticketId("T-1")]
    })
    yield* groups.complete("org", "user-1", "p", created.id, {
      destination: { kind: "backlog" }
    })
    const outcome = yield* Effect.result(
      groups.addTickets("org", "user-1", "p", created.id, [ticketId("T-2")])
    )
    expect(outcome._tag).toBe("Failure")
    if (outcome._tag === "Failure") {
      expect(outcome.failure._tag).toBe("SprintCompletedImmutable")
    }
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2"] }, { role: "admin" })
    )
  )
)

it.effect("addTickets serializes concurrent calls on the same project", () =>
  Effect.gen(function* () {
    const groups = yield* Groups
    const sprint = yield* groups.create("org", "user-1", "p", {
      name: "Sprint 1",
      kind: "sprint",
      tickets: [ticketId("T-1")]
    })
    yield* Effect.all(
      [
        groups.addTickets("org", "user-1", "p", sprint.id, [ticketId("T-2")]),
        groups.addTickets("org", "user-1", "p", sprint.id, [ticketId("T-3")])
      ],
      { concurrency: "unbounded" }
    )
    const after = yield* groups.get("org", "user-1", "p", sprint.id)
    expect([...after.tickets].sort()).toEqual(["T-1", "T-2", "T-3"])
  }).pipe(
    Effect.provide(
      makeGroupsLayer({ ticketIds: ["T-1", "T-2", "T-3"] }, { role: "admin" })
    )
  )
)

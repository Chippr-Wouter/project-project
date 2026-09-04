import { it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { expect } from "vitest"
import {
  DEFAULT_TICKET_SORT,
  NotFound,
  ProjectKey,
  TICKET_LIST_LIMIT,
  TicketId,
  TicketStatus,
  type TicketListQuery
} from "@projectproject/shared"
import { TicketsLive } from "../Layers/Tickets"
import { Attachments, type AttachmentsShape } from "./Attachments"
import { Comments, type CommentsShape } from "./Comments"
import { Db } from "./Db"
import { GitHub, type GitHubShape } from "./GitHub"
import { Groups, type GroupsShape } from "./Groups"
import { TicketIdTaken } from "./Markdown"
import {
  Projects,
  type ProjectGithubIntegration,
  type ProjectsShape
} from "./Projects"
import {
  TicketIndex,
  type TicketIndexProject,
  type TicketIndexShape
} from "./TicketIndex"
import {
  TicketDocs,
  type TicketDocsShape,
  type TicketDocument
} from "./TicketDocs"
import { Tickets } from "./Tickets"

const isoDate = (s: string) => DateTime.toDate(DateTime.unsafeMake(s))
const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)
const projectKey = Schema.decodeUnknownSync(ProjectKey)
const githubIntegration = {
  projectIntegrationLinkId: "link-1",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "p",
  installationId: "123",
  repoId: "repo-1",
  repoOwner: "acme",
  repoName: "app",
  defaultBaseBranch: "main"
} satisfies ProjectGithubIntegration
const ticketIndexProject = {
  orgSlug: "org",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "p"
} satisfies TicketIndexProject

function unexpected(method: string): Effect.Effect<never> {
  return Effect.die(new Error(`unexpected ${method} call`))
}

function makeTicketDocument(
  id: string,
  overrides: Partial<TicketDocument> = {}
): TicketDocument {
  const now = isoDate("2026-04-01T00:00:00.000Z")
  return {
    id: ticketId(id),
    title: id,
    status: ticketStatus("todo"),
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
    commentsRegion: "",
    ...overrides
  }
}

function makeFakeTicketDocs(initialIds: ReadonlyArray<string>) {
  const documents = new Map<string, TicketDocument>(
    initialIds.map((id) => [id, makeTicketDocument(id)])
  )

  const service: TicketDocsShape = {
    listIds: () => unexpected("TicketDocs.listIds"),
    read: (_org: string, _slug: string, id: string) => {
      const document = documents.get(id)
      return document ? Effect.succeed(document) : Effect.fail(new NotFound())
    },
    create: (_org: string, _slug: string, document: TicketDocument) => {
      if (documents.has(document.id)) return Effect.fail(new TicketIdTaken())
      documents.set(document.id, document)
      return Effect.void
    },
    write: (
      _org: string,
      _slug: string,
      id: string,
      document: TicketDocument
    ) => {
      documents.set(id, document)
      return Effect.void
    },
    update: (org: string, slug: string, id: string, transform) =>
      service
        .read(org, slug, id)
        .pipe(
          Effect.flatMap(transform),
          Effect.tap((document) =>
            Effect.sync(() => documents.set(id, document))
          )
        ),
    remove: (_org: string, _slug: string, id: string) => {
      documents.delete(id)
      return Effect.void
    },
    readRaw: () => unexpected("TicketDocs.readRaw")
  }

  return {
    documents,
    layer: Layer.succeed(TicketDocs, service)
  }
}

function makeFakeProjects(key: string, overrides: Partial<ProjectsShape> = {}) {
  const service = {
    list: () => unexpected("Projects.list"),
    listPaged: () => unexpected("Projects.listPaged"),
    listMembersPaged: () => unexpected("Projects.listMembersPaged"),
    create: () => unexpected("Projects.create"),
    get: () => unexpected("Projects.get"),
    getKey: () => Effect.succeed(projectKey(key)),
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
    disconnectGithub: () => unexpected("Projects.disconnectGithub"),
    ...overrides
  } satisfies ProjectsShape

  return Layer.succeed(Projects, service)
}

const FakeDb = Layer.succeed(
  Db,
  new Proxy(
    {},
    {
      get:
        (_target, prop) =>
        (..._args: ReadonlyArray<unknown>) =>
          unexpected(`Db.${String(prop)}`)
    }
  ) as never
)

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

const makeFakeAttachments = (
  overrides: Partial<AttachmentsShape> = {}
): Layer.Layer<Attachments> =>
  Layer.succeed(Attachments, {
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
    dedupeOnce: () => unexpected("Attachments.dedupeOnce"),
    ...overrides
  } satisfies AttachmentsShape)

const makeRecordingAttachments = () => {
  const calls: Array<{
    readonly orgSlug: string
    readonly slug: string
    readonly ticketId: string
    readonly body: string
  }> = []
  return {
    calls,
    layer: makeFakeAttachments({
      reconcileTicket: (orgSlug, slug, ticketId, body) =>
        Effect.sync(() => {
          calls.push({ orgSlug, slug, ticketId, body })
        })
    })
  }
}

const FakeComments = Layer.succeed(Comments, {
  list: () => unexpected("Comments.list"),
  create: () => Effect.succeed({} as never),
  edit: () => unexpected("Comments.edit"),
  remove: () => unexpected("Comments.remove")
} satisfies CommentsShape)

const makeFakeGitHub = (overrides: Partial<GitHubShape> = {}) =>
  Layer.succeed(GitHub, {
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
    listInstallationBranches: () =>
      unexpected("GitHub.listInstallationBranches"),
    branchExistsInstallation: () =>
      unexpected("GitHub.branchExistsInstallation"),
    ...overrides
  } satisfies GitHubShape)

const entryFromDocument = (document: TicketDocument) => {
  const { body: _body, commentsRegion: _commentsRegion, ...entry } = document
  return {
    ...entry,
    branchDeletedAt: null,
    checks: null,
    checksHeadSha: null,
    checksUpdatedAt: null
  }
}

const makeFakeTicketIndex = (
  documents: Map<string, TicketDocument>,
  overrides: Partial<TicketIndexShape> = {}
) => {
  let nextTicketNumber =
    Math.max(
      0,
      ...[...documents.keys()].map((id) =>
        Number(id.slice(id.lastIndexOf("-") + 1))
      )
    ) + 1
  return Layer.succeed(TicketIndex, {
    projectFor: () => Effect.succeed(ticketIndexProject),
    list: (_project, ticketIds) =>
      Effect.sync(() => {
        const wanted = ticketIds === undefined ? null : new Set(ticketIds)
        return [...documents.values()]
          .filter((document) => wanted === null || wanted.has(document.id))
          .map(entryFromDocument)
      }),
    listIds: () => Effect.sync(() => [...documents.keys()]),
    existingIds: (_project, ticketIds) =>
      Effect.sync(
        () => new Set(ticketIds.filter((ticketId) => documents.has(ticketId)))
      ),
    reserveTicketNumber: () => Effect.sync(() => nextTicketNumber++),
    tagUsageCounts: () =>
      Effect.sync(() => {
        const counts: Record<string, number> = {}
        for (const document of documents.values()) {
          for (const tag of document.tags) {
            counts[tag] = (counts[tag] ?? 0) + 1
          }
        }
        return counts
      }),
    findTicketIdsByTag: (_project, tag) =>
      Effect.sync(() =>
        [...documents.values()]
          .filter((document) => document.tags.some((t) => t === tag))
          .map((document) => document.id)
      ),
    findTicketIdsByStatus: (_project, status) =>
      Effect.sync(() =>
        [...documents.values()]
          .filter((document) => document.status === status)
          .map((document) => document.id)
      ),
    findTicketsByBranch: (projectId, branch) =>
      Effect.sync(() =>
        [...documents.values()].flatMap((document) =>
          document.branch === branch
            ? [
                {
                  ...ticketIndexProject,
                  projectId,
                  ticketId: document.id,
                  branch
                }
              ]
            : []
        )
      ),
    upsertTicket: (_project, document) =>
      Effect.sync(() => {
        documents.set(document.id, document)
      }),
    markBranchStale: () => Effect.succeed([]),
    clearBranchStale: () => Effect.void,
    updateBranchChecks: () => Effect.succeed([]),
    deleteTicket: (_project, ticketId) =>
      Effect.sync(() => {
        documents.delete(ticketId)
      }),
    rebuildProject: (project) =>
      Effect.succeed({ project, indexed: documents.size, skipped: 0 }),
    rebuildAllProjects: () =>
      Effect.succeed({
        projects: [
          { project: ticketIndexProject, indexed: documents.size, skipped: 0 }
        ]
      }),
    reconcileProject: (project) =>
      Effect.succeed({
        project,
        drift: { missing: [], orphaned: [], stale: [] },
        rebuilt: false,
        indexed: documents.size,
        skipped: 0
      }),
    reconcileAllProjects: () =>
      Effect.succeed({
        projects: [
          {
            project: ticketIndexProject,
            drift: { missing: [], orphaned: [], stale: [] },
            rebuilt: false,
            indexed: documents.size,
            skipped: 0
          }
        ],
        reconciled: 0
      }),
    ...overrides
  } satisfies TicketIndexShape)
}

const makeRecordingTicketIndex = (documents: Map<string, TicketDocument>) => {
  const calls: Array<
    | {
        readonly type: "upsert"
        readonly ticketId: string
      }
    | {
        readonly type: "clearTicket"
        readonly ticketId: string
      }
  > = []
  return {
    calls,
    layer: makeFakeTicketIndex(documents, {
      upsertTicket: (_project, document) =>
        Effect.sync(() => {
          documents.set(document.id, document)
          calls.push({ type: "upsert", ticketId: document.id })
        }),
      deleteTicket: (_project, ticketId) =>
        Effect.sync(() => {
          documents.delete(ticketId)
          calls.push({ type: "clearTicket", ticketId })
        })
    })
  }
}

function makeTicketsLayer(
  key: string,
  ticketDocsLayer: Layer.Layer<TicketDocs>,
  options: {
    readonly projects?: Layer.Layer<Projects>
    readonly github?: Layer.Layer<GitHub>
    readonly ticketIndex?: Layer.Layer<TicketIndex>
    readonly attachments?: Layer.Layer<Attachments>
  } = {}
) {
  return TicketsLive.pipe(
    Layer.provide(ticketDocsLayer),
    Layer.provide(options.projects ?? makeFakeProjects(key)),
    Layer.provide(FakeGroups),
    Layer.provide(FakeComments),
    Layer.provide(options.attachments ?? makeFakeAttachments()),
    Layer.provide(options.github ?? makeFakeGitHub()),
    Layer.provide(options.ticketIndex ?? makeFakeTicketIndex(new Map())),
    Layer.provide(FakeDb)
  )
}

function makeTicketsFixture(key: string, initialIds: ReadonlyArray<string>) {
  const docs = makeFakeTicketDocs(initialIds)
  return {
    documents: docs.documents,
    layer: makeTicketsLayer(key, docs.layer, {
      ticketIndex: makeFakeTicketIndex(docs.documents)
    })
  }
}

it.effect("listGitStates fetches only distinct ticket branches", () => {
  const docs = makeFakeTicketDocs(["T-1", "T-2", "T-3", "T-4"])
  docs.documents.set("T-1", makeTicketDocument("T-1", { branch: "feat/T-1" }))
  docs.documents.set("T-2", makeTicketDocument("T-2", { branch: "feat/T-1" }))
  docs.documents.set("T-3", makeTicketDocument("T-3", { branch: "bug/T-3" }))

  const fetchedBranches: string[][] = []
  const layer = TicketsLive.pipe(
    Layer.provide(docs.layer),
    Layer.provide(
      makeFakeProjects("T", {
        getGithubIntegration: () => Effect.succeed(githubIntegration)
      })
    ),
    Layer.provide(FakeGroups),
    Layer.provide(FakeComments),
    Layer.provide(makeFakeAttachments()),
    Layer.provide(
      makeFakeGitHub({
        fetchInstallationProjectStates: (
          _installationId,
          _owner,
          _name,
          branches
        ) => {
          fetchedBranches.push([...branches])
          return Effect.succeed({
            defaultBranch: "main",
            existingBranches: new Set(["feat/T-1", "bug/T-3"]),
            prByBranch: new Map()
          })
        }
      })
    ),
    Layer.provide(makeFakeTicketIndex(docs.documents)),
    Layer.provide(FakeDb)
  )

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.listGitStates("org", "user-1", "p")

    expect(fetchedBranches).toEqual([["feat/T-1", "bug/T-3"]])
    expect(result.states["T-1"]).toEqual({
      tag: "branch_no_pr",
      name: "feat/T-1",
      baseBranch: "main"
    })
    expect(result.states["T-4"]).toEqual({
      tag: "no_branch",
      baseBranch: "main"
    })
  }).pipe(Effect.provide(layer))
})

it.effect("createBranch writes markdown and upserts the ticket index", () => {
  const docs = makeFakeTicketDocs(["T-1"])
  const index = makeRecordingTicketIndex(docs.documents)
  const createdBranches: Array<{
    readonly owner: string
    readonly repo: string
    readonly branch: string
    readonly base: string
    readonly userId: string
  }> = []
  const layer = makeTicketsLayer("T", docs.layer, {
    projects: makeFakeProjects("T", {
      getGithubIntegration: () => Effect.succeed(githubIntegration)
    }),
    github: makeFakeGitHub({
      createBranchAsUser: (owner, repo, branch, base, userId) =>
        Effect.sync(() => {
          createdBranches.push({ owner, repo, branch, base, userId })
          return { name: branch, sha: "sha-1" }
        })
    }),
    ticketIndex: index.layer
  })

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const updated = yield* tickets.createBranch("org", "user-1", "p", "T-1", {
      name: "feat/T-1"
    })

    expect(updated.branch).toBe("feat/T-1")
    expect(docs.documents.get("T-1")?.branch).toBe("feat/T-1")
    expect(createdBranches).toEqual([
      {
        owner: "acme",
        repo: "app",
        branch: "feat/T-1",
        base: "main",
        userId: "user-1"
      }
    ])
    expect(index.calls).toEqual([
      {
        type: "upsert",
        ticketId: "T-1"
      }
    ])
  }).pipe(Effect.provide(layer))
})

it.effect(
  "remove reconciles with an empty body so the deleted ticket's attachments are orphaned",
  () => {
    const docs = makeFakeTicketDocs(["T-1"])
    const attachments = makeRecordingAttachments()
    const layer = makeTicketsLayer("T", docs.layer, {
      attachments: attachments.layer,
      ticketIndex: makeFakeTicketIndex(docs.documents)
    })

    return Effect.gen(function* () {
      const tickets = yield* Tickets
      yield* tickets.remove("org", "user-1", "p", "T-1")

      expect(attachments.calls).toEqual([
        { orgSlug: "org", slug: "p", ticketId: "T-1", body: "" }
      ])
    }).pipe(Effect.provide(layer))
  }
)

it.effect("create propagates ticket index write failures", () => {
  const docs = makeFakeTicketDocs([])
  const layer = makeTicketsLayer("T", docs.layer, {
    ticketIndex: makeFakeTicketIndex(docs.documents, {
      upsertTicket: () => Effect.die(new Error("index failed"))
    })
  })

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const exit = yield* tickets
      .create("org", "user-1", "p", { title: "Indexed" })
      .pipe(Effect.exit)

    expect(exit._tag).toBe("Failure")
  }).pipe(Effect.provide(layer))
})

it.effect(
  "clearBranch clears markdown and upserts the ticket index row",
  () => {
    const docs = makeFakeTicketDocs(["T-1"])
    docs.documents.set("T-1", makeTicketDocument("T-1", { branch: "feat/T-1" }))
    const index = makeRecordingTicketIndex(docs.documents)
    const layer = makeTicketsLayer("T", docs.layer, {
      projects: makeFakeProjects("T", {
        getGithubIntegration: () => Effect.succeed(githubIntegration)
      }),
      ticketIndex: index.layer
    })

    return Effect.gen(function* () {
      const tickets = yield* Tickets
      const updated = yield* tickets.clearBranch("org", "user-1", "p", "T-1")

      expect(updated.branch).toBeNull()
      expect(docs.documents.get("T-1")?.branch).toBeNull()
      expect(index.calls).toEqual([
        {
          type: "upsert",
          ticketId: "T-1"
        }
      ])
    }).pipe(Effect.provide(layer))
  }
)

it.effect("get uses persisted prState for the fallback git state", () => {
  const docs = makeFakeTicketDocs(["T-1"])
  docs.documents.set(
    "T-1",
    makeTicketDocument("T-1", {
      branch: "feat/T-1",
      pr: 80,
      prState: "merged",
      status: ticketStatus("done")
    })
  )
  const layer = makeTicketsLayer("T", docs.layer, {
    projects: makeFakeProjects("T", {
      getGithubIntegration: () => Effect.succeed(githubIntegration)
    })
  })

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const ticket = yield* tickets.get("org", "user-1", "p", "T-1")

    expect(ticket.gitState).toEqual({
      tag: "pr_merged",
      branch: "feat/T-1",
      baseBranch: "main",
      number: 80,
      url: "https://github.com/acme/app/pull/80",
      title: "",
      mergedAt: null
    })
  }).pipe(Effect.provide(layer))
})

it.effect("create allocates the next id from the project key", () => {
  const { documents, layer } = makeTicketsFixture("FOO", ["FOO-1", "FOO-3"])
  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const created = yield* tickets.create("org", "user-1", "p", {
      title: "Add project keys"
    })

    expect(created.id).toBe("FOO-4")
    expect(documents.has("FOO-4")).toBe(true)
  }).pipe(Effect.provide(layer))
})

it.effect("create keeps legacy T project ids readable and sequential", () => {
  const { documents, layer } = makeTicketsFixture("T", ["T-1", "T-35"])
  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const created = yield* tickets.create("org", "user-1", "p", {
      title: "Keep legacy ids"
    })

    expect(created.id).toBe("T-36")
    expect(documents.has("T-36")).toBe(true)
  }).pipe(Effect.provide(layer))
})

it.effect(
  "create advances past an unindexed file collision without scanning the ticket directory",
  () => {
    const docs = makeFakeTicketDocs(["FOO-2"])
    const indexed = new Map([["FOO-1", makeTicketDocument("FOO-1")]])
    const layer = makeTicketsLayer("FOO", docs.layer, {
      ticketIndex: makeFakeTicketIndex(indexed, {
        listIds: () => unexpected("TicketIndex.listIds")
      })
    })

    return Effect.gen(function* () {
      const tickets = yield* Tickets
      const created = yield* tickets.create("org", "user-1", "p", {
        title: "Skip stale collision"
      })

      expect(created.id).toBe("FOO-3")
      expect(docs.documents.has("FOO-3")).toBe(true)
    }).pipe(Effect.provide(layer))
  }
)

it.effect("ticket mention validation trusts the ticket index", () => {
  const docs = makeFakeTicketDocs(["T-1"])
  const layer = makeTicketsLayer("T", docs.layer, {
    ticketIndex: makeFakeTicketIndex(new Map())
  })

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const error = yield* tickets
      .create("org", "user-1", "p", {
        title: "Reference a ticket",
        body: "See [T-1](mention:ticket/T-1)."
      })
      .pipe(Effect.flip)

    expect(error).toMatchObject({
      _tag: "MentionInvalid",
      kind: "unknown_ticket"
    })
  }).pipe(Effect.provide(layer))
})

it.effect("list reads ticket index rows", () => {
  const docs = makeFakeTicketDocs(["T-1"])

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.list("org", "user-1", "project", {
      sort: DEFAULT_TICKET_SORT
    })

    expect(result.items.map((t) => t.id)).toEqual(["T-1"])
    expect(result.nextCursor).toBeNull()
  }).pipe(
    Effect.provide(
      makeTicketsLayer("T", docs.layer, {
        ticketIndex: makeFakeTicketIndex(docs.documents)
      })
    )
  )
})

it.effect("list defaults to created desc", () => {
  const { documents, layer } = makeTicketsFixture("T", [])
  documents.set(
    "T-1",
    makeTicketDocument("T-1", {
      title: "old",
      createdAt: isoDate("2026-01-01T00:00:00.000Z")
    })
  )
  documents.set(
    "T-2",
    makeTicketDocument("T-2", {
      title: "mid",
      createdAt: isoDate("2026-02-01T00:00:00.000Z")
    })
  )
  documents.set(
    "T-3",
    makeTicketDocument("T-3", {
      title: "new",
      createdAt: isoDate("2026-03-01T00:00:00.000Z")
    })
  )

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.list("org", "user-1", "p", {
      sort: DEFAULT_TICKET_SORT
    })

    expect(result.items.map((t) => t.title)).toEqual(["new", "mid", "old"])
    expect(result.nextCursor).toBeNull()
  }).pipe(Effect.provide(layer))
})

it.effect("list sorts by title asc", () => {
  const { documents, layer } = makeTicketsFixture("T", [])
  documents.set("T-1", makeTicketDocument("T-1", { title: "C" }))
  documents.set("T-2", makeTicketDocument("T-2", { title: "A" }))
  documents.set("T-3", makeTicketDocument("T-3", { title: "B" }))

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const query: TicketListQuery = {
      sort: { key: "title", dir: "asc" }
    }
    const result = yield* tickets.list("org", "user-1", "p", query)

    expect(result.items.map((t) => t.title)).toEqual(["A", "B", "C"])
  }).pipe(Effect.provide(layer))
})

it.effect("list paginates by cursor", () => {
  const { layer } = makeTicketsFixture("T", [])
  const total = TICKET_LIST_LIMIT + 5
  return Effect.gen(function* () {
    const tickets = yield* Tickets
    for (let i = 0; i < total; i++) {
      yield* tickets.create("org", "user-1", "p", { title: `t-${i}` })
    }

    const sortById: TicketListQuery = {
      sort: { key: "id", dir: "asc" }
    }
    const page1 = yield* tickets.list("org", "user-1", "p", sortById)
    expect(page1.items.length).toBe(TICKET_LIST_LIMIT)
    expect(page1.nextCursor).not.toBeNull()

    const page2 = yield* tickets.list("org", "user-1", "p", {
      ...sortById,
      cursor: page1.nextCursor ?? undefined
    })
    expect(page2.items.length).toBe(5)
    expect(page2.nextCursor).toBeNull()

    const page1Ids = new Set(page1.items.map((t) => t.id))
    for (const t of page2.items) {
      expect(page1Ids.has(t.id)).toBe(false)
    }
  }).pipe(Effect.provide(layer))
})

it.effect("list paginates by cursor with default created desc sort", () => {
  const { documents, layer } = makeTicketsFixture("T", [])
  const total = TICKET_LIST_LIMIT + 5
  const base = DateTime.unsafeMake("2026-01-01T00:00:00.000Z")
  for (let i = 0; i < total; i++) {
    const id = `T-${i + 1}`
    documents.set(
      id,
      makeTicketDocument(id, {
        title: id,
        createdAt: DateTime.toDate(DateTime.addDuration(`${i} hours`)(base))
      })
    )
  }

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const page1 = yield* tickets.list("org", "user-1", "p", {
      sort: DEFAULT_TICKET_SORT
    })
    expect(page1.items.length).toBe(TICKET_LIST_LIMIT)
    expect(page1.nextCursor).not.toBeNull()
    const page1Times = page1.items.map((t) => t.createdAt.getTime())
    for (let i = 1; i < page1Times.length; i++) {
      expect(page1Times[i - 1]).toBeGreaterThan(page1Times[i]!)
    }

    const page2 = yield* tickets.list("org", "user-1", "p", {
      sort: DEFAULT_TICKET_SORT,
      cursor: page1.nextCursor ?? undefined
    })
    expect(page2.items.length).toBe(5)
    expect(page2.nextCursor).toBeNull()
    const page2Times = page2.items.map((t) => t.createdAt.getTime())
    for (let i = 1; i < page2Times.length; i++) {
      expect(page2Times[i - 1]).toBeGreaterThan(page2Times[i]!)
    }

    const seen = new Set(page1.items.map((t) => t.id))
    for (const t of page2.items) {
      expect(seen.has(t.id)).toBe(false)
    }
  }).pipe(Effect.provide(layer))
})

it.effect("list honors an explicit limit override", () => {
  const { layer } = makeTicketsFixture("T", [])
  return Effect.gen(function* () {
    const tickets = yield* Tickets
    for (let i = 0; i < 10; i++) {
      yield* tickets.create("org", "user-1", "p", { title: `t-${i}` })
    }

    const page = yield* tickets.list(
      "org",
      "user-1",
      "p",
      { sort: { key: "id", dir: "asc" } },
      3
    )
    expect(page.items.length).toBe(3)
    expect(page.nextCursor).not.toBeNull()
  }).pipe(Effect.provide(layer))
})

it.effect("list filters by q and substitutes mine to viewerId", () => {
  const { layer } = makeTicketsFixture("T", [])
  return Effect.gen(function* () {
    const tickets = yield* Tickets
    yield* tickets.create("org", "user-1", "p", {
      title: "hello world",
      assignees: ["user-1"]
    })
    yield* tickets.create("org", "user-1", "p", {
      title: "goodbye world",
      assignees: ["user-2"]
    })

    const byQ = yield* tickets.list("org", "user-1", "p", {
      sort: DEFAULT_TICKET_SORT,
      q: "hello"
    })
    expect(byQ.items.map((t) => t.title)).toEqual(["hello world"])

    const mine = yield* tickets.list("org", "user-1", "p", {
      sort: DEFAULT_TICKET_SORT,
      filter: { assignee: ["mine"] }
    })
    expect(mine.items.map((t) => t.title)).toEqual(["hello world"])
  }).pipe(Effect.provide(layer))
})

it.effect("count returns zeros for every status on empty project", () => {
  const { layer } = makeTicketsFixture("T", [])
  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.count("org", "user-1", "p", {})
    expect(result).toEqual({
      total: 0,
      byStatus: {}
    })
  }).pipe(Effect.provide(layer))
})

it.effect("count aggregates byStatus across a mixed-status project", () => {
  const { documents, layer } = makeTicketsFixture("T", [])
  documents.set(
    "T-1",
    makeTicketDocument("T-1", { status: ticketStatus("todo") })
  )
  documents.set(
    "T-2",
    makeTicketDocument("T-2", { status: ticketStatus("todo") })
  )
  documents.set(
    "T-3",
    makeTicketDocument("T-3", { status: ticketStatus("todo") })
  )
  documents.set(
    "T-4",
    makeTicketDocument("T-4", { status: ticketStatus("in_progress") })
  )
  documents.set(
    "T-5",
    makeTicketDocument("T-5", { status: ticketStatus("in_progress") })
  )
  documents.set(
    "T-6",
    makeTicketDocument("T-6", { status: ticketStatus("done") })
  )

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.count("org", "user-1", "p", {})
    expect(result).toEqual({
      total: 6,
      byStatus: { todo: 3, in_progress: 2, done: 1 }
    })
  }).pipe(Effect.provide(layer))
})

it.effect(
  "count strips status from filter so chip counts stay meaningful",
  () => {
    const { documents, layer } = makeTicketsFixture("T", [])
    documents.set(
      "T-1",
      makeTicketDocument("T-1", { status: ticketStatus("todo") })
    )
    documents.set(
      "T-2",
      makeTicketDocument("T-2", { status: ticketStatus("todo") })
    )
    documents.set(
      "T-3",
      makeTicketDocument("T-3", { status: ticketStatus("todo") })
    )
    documents.set(
      "T-4",
      makeTicketDocument("T-4", { status: ticketStatus("in_progress") })
    )
    documents.set(
      "T-5",
      makeTicketDocument("T-5", { status: ticketStatus("in_progress") })
    )
    documents.set(
      "T-6",
      makeTicketDocument("T-6", { status: ticketStatus("done") })
    )

    return Effect.gen(function* () {
      const tickets = yield* Tickets
      const result = yield* tickets.count("org", "user-1", "p", {
        filter: { status: [ticketStatus("done")] }
      })
      expect(result).toEqual({
        total: 6,
        byStatus: { todo: 3, in_progress: 2, done: 1 }
      })
    }).pipe(Effect.provide(layer))
  }
)

it.effect("count still applies non-status filters", () => {
  const { documents, layer } = makeTicketsFixture("T", [])
  documents.set(
    "T-1",
    makeTicketDocument("T-1", { status: ticketStatus("todo"), type: "feat" })
  )
  documents.set(
    "T-2",
    makeTicketDocument("T-2", {
      status: ticketStatus("in_progress"),
      type: "feat"
    })
  )
  documents.set(
    "T-3",
    makeTicketDocument("T-3", { status: ticketStatus("done"), type: "feat" })
  )
  documents.set(
    "T-4",
    makeTicketDocument("T-4", { status: ticketStatus("todo"), type: "bug" })
  )
  documents.set(
    "T-5",
    makeTicketDocument("T-5", {
      status: ticketStatus("in_progress"),
      type: "bug"
    })
  )

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.count("org", "user-1", "p", {
      filter: { type: ["bug"] }
    })
    expect(result).toEqual({
      total: 2,
      byStatus: { todo: 1, in_progress: 1 }
    })
  }).pipe(Effect.provide(layer))
})

it.effect("count substitutes mine to viewerId like list", () => {
  const { documents, layer } = makeTicketsFixture("T", [])
  documents.set(
    "T-1",
    makeTicketDocument("T-1", {
      status: ticketStatus("todo"),
      assignees: ["user-1"]
    })
  )
  documents.set(
    "T-2",
    makeTicketDocument("T-2", {
      status: ticketStatus("in_progress"),
      assignees: ["user-1"]
    })
  )
  documents.set(
    "T-3",
    makeTicketDocument("T-3", {
      status: ticketStatus("done"),
      assignees: ["user-2"]
    })
  )

  return Effect.gen(function* () {
    const tickets = yield* Tickets
    const result = yield* tickets.count("org", "user-1", "p", {
      filter: { assignee: ["mine"] }
    })
    expect(result).toEqual({
      total: 2,
      byStatus: { todo: 1, in_progress: 1 }
    })
  }).pipe(Effect.provide(layer))
})

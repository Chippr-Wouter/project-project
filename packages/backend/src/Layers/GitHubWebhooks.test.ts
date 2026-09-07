import { it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { expect } from "vitest"
import {
  applyPullRequestWebhookToTicket,
  makeGitHubWebhooks,
  type PullRequestWebhookMatch
} from "./GitHubWebhooks"
import type {
  GitHubBranchDeletionChange,
  GitHubCheckWebhookChange,
  GitHubPullRequestWebhookChange,
  GitHubRepositoryMetadataChange,
  GitHubWebhookMutationSink
} from "../Services/GitHubWebhooks"
import { NotFound, TicketId, TicketStatus } from "@projectproject/shared"
import {
  MalformedTicketDocument,
  type TicketDocsShape,
  type TicketDocument
} from "../Services/TicketDocs"
import type { TicketIndexShape } from "../Services/TicketIndex"

type Call =
  | { readonly type: "deleted"; readonly installationId: string }
  | { readonly type: "suspended"; readonly installationId: string }
  | { readonly type: "unsuspended"; readonly installationId: string }
  | {
      readonly type: "reposRemoved"
      readonly installationId: string
      readonly repoIds: ReadonlyArray<string>
    }
  | {
      readonly type: "pullRequestChanged"
      readonly change: GitHubPullRequestWebhookChange
    }
  | {
      readonly type: "repositoryRenamed"
      readonly change: GitHubRepositoryMetadataChange
    }
  | {
      readonly type: "repositoryTransferred"
      readonly change: GitHubRepositoryMetadataChange
    }
  | {
      readonly type: "repositoryArchived"
      readonly installationId: string
      readonly repoId: string
    }
  | {
      readonly type: "repositoryUnarchived"
      readonly installationId: string
      readonly repoId: string
    }
  | {
      readonly type: "repositoryDeleted"
      readonly installationId: string
      readonly repoId: string
    }
  | {
      readonly type: "branchDeleted"
      readonly change: GitHubBranchDeletionChange
    }
  | {
      readonly type: "checkStateChanged"
      readonly change: GitHubCheckWebhookChange
    }

const makeSink = (calls: Array<Call>): GitHubWebhookMutationSink => ({
  installationDeleted: (installationId) =>
    Effect.sync(() => {
      calls.push({ type: "deleted", installationId })
    }),
  installationSuspended: (installationId) =>
    Effect.sync(() => {
      calls.push({ type: "suspended", installationId })
    }),
  installationUnsuspended: (installationId) =>
    Effect.sync(() => {
      calls.push({ type: "unsuspended", installationId })
    }),
  repositoriesRemoved: (installationId, repoIds) =>
    Effect.sync(() => {
      calls.push({ type: "reposRemoved", installationId, repoIds })
    }),
  pullRequestChanged: (change) =>
    Effect.sync(() => {
      calls.push({ type: "pullRequestChanged", change })
    }),
  repositoryRenamed: (change) =>
    Effect.sync(() => {
      calls.push({ type: "repositoryRenamed", change })
    }),
  repositoryTransferred: (change) =>
    Effect.sync(() => {
      calls.push({ type: "repositoryTransferred", change })
    }),
  repositoryArchived: (installationId, repoId) =>
    Effect.sync(() => {
      calls.push({ type: "repositoryArchived", installationId, repoId })
    }),
  repositoryUnarchived: (installationId, repoId) =>
    Effect.sync(() => {
      calls.push({ type: "repositoryUnarchived", installationId, repoId })
    }),
  repositoryDeleted: (installationId, repoId) =>
    Effect.sync(() => {
      calls.push({ type: "repositoryDeleted", installationId, repoId })
    }),
  branchDeleted: (change) =>
    Effect.sync(() => {
      calls.push({ type: "branchDeleted", change })
    }),
  checkStateChanged: (change) =>
    Effect.sync(() => {
      calls.push({ type: "checkStateChanged", change })
    })
})

const delivery = (event: string, body: unknown) => ({
  event,
  deliveryId: "delivery-1",
  body: Schema.encodeSync(Schema.parseJson())(body)
})

it.effect("dispatches installation.deleted", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("installation", {
        action: "deleted",
        installation: { id: 123 }
      })
    )
    expect(calls).toEqual([{ type: "deleted", installationId: "123" }])
  })
)

it.effect("dispatches installation.suspend", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("installation", {
        action: "suspend",
        installation: { id: 123 }
      })
    )
    expect(calls).toEqual([{ type: "suspended", installationId: "123" }])
  })
)

it.effect("dispatches installation.unsuspend", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("installation", {
        action: "unsuspend",
        installation: { id: 123 }
      })
    )
    expect(calls).toEqual([{ type: "unsuspended", installationId: "123" }])
  })
)

it.effect("dispatches installation_repositories.removed with repo ids", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("installation_repositories", {
        action: "removed",
        installation: { id: "123" },
        repositories_removed: [{ id: 456 }, { id: "789" }]
      })
    )
    expect(calls).toEqual([
      {
        type: "reposRemoved",
        installationId: "123",
        repoIds: ["456", "789"]
      }
    ])
  })
)

it.effect("dispatches handled pull_request actions", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    const cases = [
      { action: "opened", merged: false, expectedState: "open" },
      { action: "reopened", merged: false, expectedState: "open" },
      { action: "synchronize", merged: false, expectedState: "open" },
      { action: "closed", merged: false, expectedState: "closed" },
      { action: "closed", merged: true, expectedState: "merged" }
    ]
    for (const input of cases) {
      yield* webhooks.handle(
        delivery("pull_request", {
          action: input.action,
          installation: { id: "123" },
          repository: { id: "456" },
          number: 80,
          pull_request: {
            merged: input.merged,
            head: { ref: "feat/T-84-pr-webhook-lifecycle", repo: { id: 456 } }
          }
        })
      )
    }
    expect(calls).toEqual(
      cases.map((input) => ({
        type: "pullRequestChanged",
        change: {
          installationId: "123",
          repositoryId: "456",
          branch: "feat/T-84-pr-webhook-lifecycle",
          number: 80,
          state: input.expectedState
        }
      }))
    )
  })
)

it.effect("ignores unhandled pull_request actions and fork pull requests", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("pull_request", {
        action: "edited",
        installation: { id: "123" },
        repository: { id: "456" },
        number: 80,
        pull_request: {
          merged: false,
          head: { ref: "feat/T-84-pr-webhook-lifecycle", repo: { id: 456 } }
        }
      })
    )
    yield* webhooks.handle(
      delivery("pull_request", {
        action: "opened",
        installation: { id: "123" },
        repository: { id: "456" },
        number: 80,
        pull_request: {
          merged: false,
          head: { ref: "feat/T-84-pr-webhook-lifecycle", repo: { id: 999 } }
        }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("ignores unhandled events and actions", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(delivery("push", { action: "created" }))
    yield* webhooks.handle(
      delivery("installation", {
        action: "created",
        installation: { id: 123 }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("logs and ignores malformed handled payloads", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle({
      event: "installation",
      deliveryId: "delivery-1",
      body: "{"
    })
    yield* webhooks.handle(
      delivery("installation_repositories", {
        action: "removed",
        installation: { id: 123 }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("dispatches repository.renamed with metadata matched by repo id", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("repository", {
        action: "renamed",
        installation: { id: "123" },
        repository: {
          id: 456,
          name: "new-name",
          owner: { login: "acme" },
          default_branch: "main"
        }
      })
    )
    expect(calls).toEqual([
      {
        type: "repositoryRenamed",
        change: {
          installationId: "123",
          repoId: "456",
          owner: "acme",
          name: "new-name",
          defaultBranch: "main"
        }
      }
    ])
  })
)

it.effect("dispatches repository.transferred with metadata", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("repository", {
        action: "transferred",
        installation: { id: 123 },
        repository: {
          id: "456",
          name: "repo",
          owner: { login: "newowner" },
          default_branch: "trunk"
        }
      })
    )
    expect(calls).toEqual([
      {
        type: "repositoryTransferred",
        change: {
          installationId: "123",
          repoId: "456",
          owner: "newowner",
          name: "repo",
          defaultBranch: "trunk"
        }
      }
    ])
  })
)

it.effect(
  "dispatches repository.archived, unarchived and deleted by repo id",
  () =>
    Effect.gen(function* () {
      const calls: Array<Call> = []
      const webhooks = makeGitHubWebhooks(makeSink(calls))
      for (const action of ["archived", "unarchived", "deleted"]) {
        yield* webhooks.handle(
          delivery("repository", {
            action,
            installation: { id: "123" },
            repository: { id: 456 }
          })
        )
      }
      expect(calls).toEqual([
        { type: "repositoryArchived", installationId: "123", repoId: "456" },
        { type: "repositoryUnarchived", installationId: "123", repoId: "456" },
        { type: "repositoryDeleted", installationId: "123", repoId: "456" }
      ])
    })
)

it.effect("ignores unhandled repository actions", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    for (const action of ["created", "edited", "publicized", "privatized"]) {
      yield* webhooks.handle(
        delivery("repository", {
          action,
          installation: { id: "123" },
          repository: { id: 456 }
        })
      )
    }
    expect(calls).toEqual([])
  })
)

it.effect("ignores repository.renamed missing metadata", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("repository", {
        action: "renamed",
        installation: { id: "123" },
        repository: { id: 456, name: "new-name" }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("dispatches delete of a branch ref matched by repo id", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("delete", {
        ref: "feat/T-85-branch-deletion-webhooks",
        ref_type: "branch",
        installation: { id: 123 },
        repository: { id: 456, default_branch: "main" }
      })
    )
    expect(calls).toEqual([
      {
        type: "branchDeleted",
        change: {
          installationId: "123",
          repositoryId: "456",
          branch: "feat/T-85-branch-deletion-webhooks"
        }
      }
    ])
  })
)

it.effect("processes repeated delete deliveries idempotently at the sink", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    const payload = {
      ref: "feat/T-1",
      ref_type: "branch",
      installation: { id: "123" },
      repository: { id: "456", default_branch: "main" }
    }
    yield* webhooks.handle(delivery("delete", payload))
    yield* webhooks.handle(delivery("delete", payload))
    expect(calls).toEqual([
      {
        type: "branchDeleted",
        change: {
          installationId: "123",
          repositoryId: "456",
          branch: "feat/T-1"
        }
      },
      {
        type: "branchDeleted",
        change: {
          installationId: "123",
          repositoryId: "456",
          branch: "feat/T-1"
        }
      }
    ])
  })
)

it.effect("ignores delete of the default branch and of tag refs", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("delete", {
        ref: "main",
        ref_type: "branch",
        installation: { id: "123" },
        repository: { id: "456", default_branch: "main" }
      })
    )
    yield* webhooks.handle(
      delivery("delete", {
        ref: "v1.0.0",
        ref_type: "tag",
        installation: { id: "123" },
        repository: { id: "456", default_branch: "main" }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("logs and ignores malformed delete payloads", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("delete", {
        ref_type: "branch",
        installation: { id: "123" },
        repository: { id: "456" }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("maps check_suite status and conclusion to check state", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    const cases = [
      { status: "completed", conclusion: "success", checks: "passing" },
      { status: "completed", conclusion: "failure", checks: "failing" },
      { status: "completed", conclusion: "timed_out", checks: "failing" },
      { status: "completed", conclusion: "neutral", checks: "neutral" },
      { status: "completed", conclusion: "cancelled", checks: "neutral" },
      { status: "completed", conclusion: null, checks: "neutral" },
      { status: "queued", conclusion: null, checks: "pending" },
      { status: "in_progress", conclusion: null, checks: "pending" }
    ] as const
    for (const input of cases) {
      yield* webhooks.handle(
        delivery("check_suite", {
          action: input.status === "completed" ? "completed" : "requested",
          installation: { id: "123" },
          repository: { id: "456" },
          check_suite: {
            head_branch: "feat/T-83-check-status-webhooks",
            head_sha: "sha-1",
            status: input.status,
            conclusion: input.conclusion,
            updated_at: "2026-07-04T10:00:00.000Z"
          }
        })
      )
    }
    expect(calls).toEqual(
      cases.map((input) => ({
        type: "checkStateChanged",
        change: {
          installationId: "123",
          repositoryId: "456",
          branch: "feat/T-83-check-status-webhooks",
          headSha: "sha-1",
          checks: input.checks,
          updatedAt: DateTime.toDate(DateTime.unsafeMake("2026-07-04T10:00:00.000Z"))
        }
      }))
    )
  })
)

it.effect("ignores check_suite deliveries without a head branch", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("check_suite", {
        action: "completed",
        installation: { id: "123" },
        repository: { id: "456" },
        check_suite: {
          head_branch: null,
          head_sha: "sha-1",
          status: "completed",
          conclusion: "success",
          updated_at: "2026-07-04T10:00:00.000Z"
        }
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("dispatches commit status state as check state for branch heads", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    const cases = [
      { state: "success", checks: "passing" },
      { state: "failure", checks: "failing" },
      { state: "error", checks: "failing" },
      { state: "pending", checks: "pending" }
    ] as const
    for (const input of cases) {
      yield* webhooks.handle(
        delivery("status", {
          installation: { id: "123" },
          repository: { id: "456" },
          sha: "sha-1",
          state: input.state,
          updated_at: "2026-07-04T10:00:00.000Z",
          branches: [
            { name: "feat/T-83-check-status-webhooks", commit: { sha: "sha-1" } },
            { name: "main", commit: { sha: "other-sha" } }
          ]
        })
      )
    }
    expect(calls).toEqual(
      cases.map((input) => ({
        type: "checkStateChanged",
        change: {
          installationId: "123",
          repositoryId: "456",
          branch: "feat/T-83-check-status-webhooks",
          headSha: "sha-1",
          checks: input.checks,
          updatedAt: DateTime.toDate(DateTime.unsafeMake("2026-07-04T10:00:00.000Z"))
        }
      }))
    )
  })
)

it.effect("ignores commit status for commits that are not a branch head", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("status", {
        installation: { id: "123" },
        repository: { id: "456" },
        sha: "sha-1",
        state: "success",
        updated_at: "2026-07-04T10:00:00.000Z",
        branches: [{ name: "main", commit: { sha: "other-sha" } }]
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("ignores check_run events and unknown commit status states", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("check_run", {
        action: "completed",
        installation: { id: "123" },
        repository: { id: "456" }
      })
    )
    yield* webhooks.handle(
      delivery("status", {
        installation: { id: "123" },
        repository: { id: "456" },
        sha: "sha-1",
        state: "unknown",
        updated_at: "2026-07-04T10:00:00.000Z",
        branches: [
          { name: "feat/T-83-check-status-webhooks", commit: { sha: "sha-1" } }
        ]
      })
    )
    expect(calls).toEqual([])
  })
)

it.effect("logs and ignores malformed check payloads", () =>
  Effect.gen(function* () {
    const calls: Array<Call> = []
    const webhooks = makeGitHubWebhooks(makeSink(calls))
    yield* webhooks.handle(
      delivery("check_suite", {
        action: "completed",
        installation: { id: "123" },
        repository: { id: "456" }
      })
    )
    yield* webhooks.handle(
      delivery("status", {
        installation: { id: "123" },
        repository: { id: "456" },
        state: "success"
      })
    )
    expect(calls).toEqual([])
  })
)

const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)

const baseDocument = (overrides: Partial<TicketDocument> = {}): TicketDocument => ({
  id: ticketId("T-1"),
  title: "first",
  status: ticketStatus("in_progress"),
  type: "feat",
  priority: "med",
  tags: [],
  branch: "feat/T-1",
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  assignees: [],
  archivedAt: null,
  createdBy: "user-1",
  createdAt: DateTime.toDate(DateTime.unsafeMake("2026-05-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.unsafeMake("2026-05-01T00:00:00.000Z")),
  body: "",
  commentsRegion: "",
  ...overrides
})

const baseMatch = (overrides: Partial<PullRequestWebhookMatch> = {}): PullRequestWebhookMatch => ({
  orgSlug: "org",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "p",
  ticketId: "T-1",
  branch: "feat/T-1",
  ...overrides
})

const makeFakeDocs = (initial: ReadonlyArray<TicketDocument>) => {
  const documents = new Map(initial.map((doc) => [doc.id as string, doc]))
  const writes: Array<{ id: string; document: TicketDocument }> = []
  const reads: Array<string> = []
  const shape: TicketDocsShape = {
    listIds: () => Effect.succeed([...documents.keys()].map((id) => ticketId(id))),
    read: (_org, _slug, id) => {
      reads.push(id)
      const doc = documents.get(id)
      return doc ? Effect.succeed(doc) : Effect.fail(new NotFound())
    },
    create: () => Effect.die(new Error("unexpected TicketDocs.create call")),
    write: (_org, _slug, id, document) =>
      Effect.sync(() => {
        documents.set(id, document)
        writes.push({ id, document })
      }),
    update: (_org, _slug, id, transform, onPersist) => {
      reads.push(id)
      const document = documents.get(id)
      if (!document) return Effect.fail(new NotFound())
      return transform(document).pipe(
        Effect.tap((next) =>
          next === document
            ? Effect.void
            : Effect.sync(() => {
                documents.set(id, next)
                writes.push({ id, document: next })
              })
        ),
        Effect.tap((next) => onPersist ? onPersist(next) : Effect.void)
      )
    },
    remove: () => Effect.die(new Error("unexpected TicketDocs.remove call")),
    readRaw: () => Effect.die(new Error("unexpected TicketDocs.readRaw call"))
  }
  return { documents, writes, reads, shape }
}

const makeFakeIndex = (overrides: Partial<TicketIndexShape> = {}) => {
  const upserts: Array<{ projectId: string; ticketId: string }> = []
  const shape: TicketIndexShape = {
    projectFor: () => Effect.die(new Error("unexpected TicketIndex.projectFor call")),
    list: () => Effect.succeed([]),
    query: () => Effect.succeed([]),
    count: () => Effect.succeed({ total: 0, byStatus: {} }),
    listIds: () => Effect.succeed([]),
    existingIds: () => Effect.succeed(new Set()),
    reserveTicketNumber: () => Effect.succeed(1),
    tagUsageCounts: () => Effect.succeed({}),
    findTicketIdsByTag: () => Effect.succeed([]),
    findTicketIdsByStatus: () => Effect.succeed([]),
    findTicketsByBranch: () => Effect.succeed([]),
    getBranchDeletedAt: () => Effect.succeed(null),
    upsertTicket: (project, document) =>
      Effect.sync(() => {
        upserts.push({ projectId: project.projectId, ticketId: document.id })
      }),
    markBranchStale: () => Effect.succeed([]),
    clearBranchStale: () => Effect.void,
    updateBranchChecks: () => Effect.succeed([]),
    deleteTicket: () => Effect.void,
    rebuildProject: () =>
      Effect.die(new Error("unexpected TicketIndex.rebuildProject call")),
    rebuildAllProjects: () =>
      Effect.die(new Error("unexpected TicketIndex.rebuildAllProjects call")),
    reconcileProject: () =>
      Effect.die(new Error("unexpected TicketIndex.reconcileProject call")),
    reconcileAllProjects: () =>
      Effect.die(
        new Error("unexpected TicketIndex.reconcileAllProjects call")
      ),
    ...overrides
  }
  return { upserts, shape }
}

const openChange: GitHubPullRequestWebhookChange = {
  installationId: "123",
  repositoryId: "456",
  branch: "feat/T-1",
  number: 80,
  state: "open"
}

it.effect("applyPullRequestWebhookToTicket writes markdown and upserts the index on opened", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([baseDocument()])
    const index = makeFakeIndex()

    yield* applyPullRequestWebhookToTicket(
      { ticketDocs: docs.shape, ticketIndex: index.shape },
      baseMatch(),
      openChange,
      "delivery-1"
    )

    expect(docs.writes).toHaveLength(1)
    expect(docs.writes[0].document.pr).toBe(80)
    expect(docs.writes[0].document.prState).toBe("open")
    expect(docs.writes[0].document.status).toBe("in_progress")
    expect(index.upserts).toEqual([{ projectId: "project-1", ticketId: "T-1" }])
  })
)

it.effect("applyPullRequestWebhookToTicket propagates index write failures", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([baseDocument()])
    const index = makeFakeIndex({
      getBranchDeletedAt: () => Effect.succeed(null),
      upsertTicket: () => Effect.die(new Error("index failed"))
    })

    const exit = yield* applyPullRequestWebhookToTicket(
      { ticketDocs: docs.shape, ticketIndex: index.shape },
      baseMatch(),
      openChange,
      "delivery-1"
    ).pipe(Effect.exit)

    expect(exit._tag).toBe("Failure")
    expect(docs.writes).toHaveLength(1)
  })
)

it.effect("applyPullRequestWebhookToTicket serializes same-ticket deliveries", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([baseDocument()])
    const index = makeFakeIndex()
    let activeReads = 0
    let maxActiveReads = 0
    const serialDocs: TicketDocsShape = {
      ...docs.shape,
      update: (org, slug, id, transform, onPersist) =>
        Effect.gen(function* () {
          activeReads += 1
          maxActiveReads = Math.max(maxActiveReads, activeReads)
          yield* Effect.yieldNow()
          return yield* docs.shape.update(org, slug, id, transform, onPersist)
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              activeReads -= 1
            })
          )
        )
    }

    yield* Effect.all(
      [
        applyPullRequestWebhookToTicket(
          { ticketDocs: serialDocs, ticketIndex: index.shape },
          baseMatch(),
          openChange,
          "delivery-1"
        ),
        applyPullRequestWebhookToTicket(
          { ticketDocs: serialDocs, ticketIndex: index.shape },
          baseMatch(),
          openChange,
          "delivery-2"
        )
      ],
      { concurrency: "unbounded" }
    )

    expect(maxActiveReads).toBe(1)
    expect(docs.writes).toHaveLength(1)
    expect(index.upserts).toHaveLength(1)
  })
)

it.effect("applyPullRequestWebhookToTicket skips when ticket markdown branch no longer matches the index row", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([baseDocument({ branch: "feat/T-1-renamed" })])
    const index = makeFakeIndex()

    yield* applyPullRequestWebhookToTicket(
      { ticketDocs: docs.shape, ticketIndex: index.shape },
      baseMatch({ branch: "feat/T-1" }),
      openChange,
      "delivery-1"
    )

    expect(docs.writes).toEqual([])
    expect(index.upserts).toEqual([])
  })
)

it.effect("applyPullRequestWebhookToTicket skips when markdown is malformed", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([])
    const index = makeFakeIndex()
    const malformedDocs: TicketDocsShape = {
      ...docs.shape,
      update: () =>
        Effect.fail(
          new MalformedTicketDocument({
            orgSlug: "org",
            slug: "p",
            ticketId: "T-1",
            path: "orgs/org/projects/p/tickets/T-1.md",
            reason: "invalid_frontmatter",
            cause: "boom"
          })
        )
    }

    yield* applyPullRequestWebhookToTicket(
      { ticketDocs: malformedDocs, ticketIndex: index.shape },
      baseMatch(),
      openChange,
      "delivery-1"
    )

    expect(docs.writes).toEqual([])
    expect(index.upserts).toEqual([])
  })
)

it.effect("applyPullRequestWebhookToTicket drops a webhook for an older PR number", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([
      baseDocument({ pr: 81, prState: "open" })
    ])
    const index = makeFakeIndex()

    yield* applyPullRequestWebhookToTicket(
      { ticketDocs: docs.shape, ticketIndex: index.shape },
      baseMatch(),
      { ...openChange, number: 80 },
      "delivery-1"
    )

    expect(docs.writes).toEqual([])
    expect(index.upserts).toEqual([])
  })
)

it.effect("applyPullRequestWebhookToTicket transitions to done once on merged", () =>
  Effect.gen(function* () {
    const docs = makeFakeDocs([baseDocument()])
    const index = makeFakeIndex()

    yield* applyPullRequestWebhookToTicket(
      { ticketDocs: docs.shape, ticketIndex: index.shape },
      baseMatch(),
      { ...openChange, state: "merged" },
      "delivery-1"
    )

    expect(docs.writes).toHaveLength(1)
    expect(docs.writes[0].document.status).toBe("done")
    expect(docs.writes[0].document.prState).toBe("merged")
    expect(docs.writes[0].document.lastTransitionedPr).toBe(80)

    yield* applyPullRequestWebhookToTicket(
      { ticketDocs: docs.shape, ticketIndex: index.shape },
      baseMatch(),
      { ...openChange, state: "merged" },
      "delivery-2"
    )

    expect(docs.writes).toHaveLength(1)
    expect(index.upserts).toHaveLength(1)
  })
)

import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { ChecksStatus } from "@projectproject/shared"
import { and, eq, inArray } from "drizzle-orm"
import {
  organizationGithubIntegration,
  organizationIntegration,
  projectGithubRepository,
  projectIntegrationLink
} from "../db/schema"
import { Db } from "../Services/Db"
import type { MarkdownError } from "../Services/Markdown"
import {
  GitHubWebhooks,
  type GitHubBranchDeletionChange,
  type GitHubCheckWebhookChange,
  type GitHubWebhookDelivery,
  type GitHubWebhookMutationSink,
  type GitHubPullRequestWebhookChange,
  type GitHubRepositoryMetadataChange,
  type GitHubWebhooksShape
} from "../Services/GitHubWebhooks"
import { TicketDocs, type TicketDocsShape } from "../Services/TicketDocs"
import { TicketIndex, type TicketIndexShape } from "../Services/TicketIndex"
import { planPullRequestWebhookTicket } from "../ticketGitStatePlanner"
import * as TicketDocumentLock from "../ticketDocumentLock"
import * as ProjectStateCache from "./GitHub/projectStateCache"

export interface PullRequestWebhookMatch {
  readonly orgSlug: string
  readonly organizationId: string
  readonly projectId: string
  readonly projectSlug: string
  readonly ticketId: string
  readonly branch: string
}

export const applyPullRequestWebhookToTicket = (
  deps: {
    readonly ticketDocs: TicketDocsShape
    readonly ticketIndex: TicketIndexShape
    readonly ticketDocumentLock: TicketDocumentLock.TicketDocumentLock["Service"]
  },
  match: PullRequestWebhookMatch,
  change: GitHubPullRequestWebhookChange,
  deliveryId: string | null
): Effect.Effect<void, MarkdownError> =>
  deps.ticketDocumentLock.withTicketDocumentLock(
    match.orgSlug,
    match.projectSlug,
    match.ticketId,
    Effect.gen(function* () {
      const indexProject = {
        orgSlug: match.orgSlug,
        organizationId: match.organizationId,
        projectId: match.projectId,
        projectSlug: match.projectSlug
      }
      let changed = false
      const next = yield* deps.ticketDocs
        .update(
          match.orgSlug,
          match.projectSlug,
          match.ticketId,
          (ticket) =>
            Effect.gen(function* () {
              if (ticket.branch !== match.branch) {
                yield* Effect.logDebug(
                  "github pull_request branch index stale"
                ).pipe(
                  Effect.annotateLogs({
                    module: "GitHubWebhooks",
                    deliveryId,
                    orgSlug: match.orgSlug,
                    slug: match.projectSlug,
                    ticketId: match.ticketId,
                    indexedBranch: match.branch,
                    ticketBranch: ticket.branch
                  })
                )
                return ticket
              }
              if (ticket.pr !== null && change.number < ticket.pr) {
                yield* Effect.logDebug(
                  "github pull_request delivery stale"
                ).pipe(
                  Effect.annotateLogs({
                    module: "GitHubWebhooks",
                    deliveryId,
                    orgSlug: match.orgSlug,
                    slug: match.projectSlug,
                    ticketId: match.ticketId,
                    ticketPr: ticket.pr,
                    webhookPr: change.number
                  })
                )
                return ticket
              }
              const write = planPullRequestWebhookTicket(ticket, change)
              if (!write) return ticket
              changed = true
              return {
                ...ticket,
                pr: write.patch.pr !== undefined ? write.patch.pr : ticket.pr,
                prState:
                  write.patch.prState !== undefined
                    ? write.patch.prState
                    : ticket.prState,
                lastTransitionedPr:
                  write.patch.lastTransitionedPr !== undefined
                    ? write.patch.lastTransitionedPr
                    : ticket.lastTransitionedPr,
                status: write.patch.status ?? ticket.status,
                updatedAt: yield* DateTime.nowAsDate
              }
            }),
          (next) =>
            changed
              ? deps.ticketIndex.upsertTicket(indexProject, next)
              : Effect.void
        )
        .pipe(
          Effect.catchTag("NotFound", (error) =>
            Effect.logWarning("github pull_request ticket ignored").pipe(
              Effect.annotateLogs({
                module: "GitHubWebhooks",
                deliveryId,
                orgSlug: match.orgSlug,
                slug: match.projectSlug,
                ticketId: match.ticketId,
                error
              }),
              Effect.as(null)
            )
          ),
          Effect.catchTag("MalformedTicketDocument", (error) =>
            Effect.logWarning("github pull_request ticket ignored").pipe(
              Effect.annotateLogs({
                module: "GitHubWebhooks",
                deliveryId,
                orgSlug: match.orgSlug,
                slug: match.projectSlug,
                ticketId: match.ticketId,
                error
              }),
              Effect.as(null)
            )
          ),
          Effect.tapError((error) =>
            Effect.logWarning("github pull_request ticket write failed").pipe(
              Effect.annotateLogs({
                module: "GitHubWebhooks",
                deliveryId,
                orgSlug: match.orgSlug,
                slug: match.projectSlug,
                ticketId: match.ticketId,
                error
              })
            )
          )
        )
      if (next === null || !changed) return
      yield* Effect.logInfo("github pull_request ticket updated").pipe(
        Effect.annotateLogs({
          module: "GitHubWebhooks",
          deliveryId,
          orgSlug: match.orgSlug,
          slug: match.projectSlug,
          ticketId: match.ticketId,
          pr: next.pr,
          prState: next.prState,
          status: next.status
        })
      )
    })
  )

const GitHubId = Schema.Union([Schema.Number, Schema.String])

const InstallationPayload = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({
    id: GitHubId
  })
})

const InstallationRepositoriesPayload = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({
    id: GitHubId
  }),
  repositories_removed: Schema.Array(
    Schema.Struct({
      id: GitHubId
    })
  )
})

const PullRequestPayload = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({
    id: GitHubId
  }),
  repository: Schema.Struct({
    id: GitHubId
  }),
  number: Schema.Number,
  pull_request: Schema.Struct({
    merged: Schema.Boolean,
    head: Schema.Struct({
      ref: Schema.String,
      repo: Schema.Struct({
        id: GitHubId
      })
    })
  })
})

const DeletePayload = Schema.Struct({
  ref: Schema.String,
  ref_type: Schema.String,
  installation: Schema.Struct({
    id: GitHubId
  }),
  repository: Schema.Struct({
    id: GitHubId,
    default_branch: Schema.optional(Schema.String)
  })
})

const RepositoryPayload = Schema.Struct({
  action: Schema.String,
  installation: Schema.Struct({
    id: GitHubId
  }),
  repository: Schema.Struct({
    id: GitHubId,
    name: Schema.optional(Schema.String),
    owner: Schema.optional(
      Schema.Struct({
        login: Schema.String
      })
    ),
    default_branch: Schema.optional(Schema.String)
  })
})

const CheckSuitePayload = Schema.Struct({
  installation: Schema.Struct({
    id: GitHubId
  }),
  repository: Schema.Struct({
    id: GitHubId
  }),
  check_suite: Schema.Struct({
    head_branch: Schema.NullOr(Schema.String),
    head_sha: Schema.String,
    status: Schema.String,
    conclusion: Schema.NullOr(Schema.String),
    updated_at: Schema.DateFromString
  })
})

const StatusPayload = Schema.Struct({
  installation: Schema.Struct({
    id: GitHubId
  }),
  repository: Schema.Struct({
    id: GitHubId
  }),
  sha: Schema.String,
  state: Schema.String,
  updated_at: Schema.DateFromString,
  branches: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      commit: Schema.Struct({
        sha: Schema.String
      })
    })
  )
})

const idToString = (id: typeof GitHubId.Type): string => String(id)

const checkSuiteChecks = (
  status: string,
  conclusion: string | null
): ChecksStatus => {
  if (status !== "completed") return "pending"
  if (conclusion === "success") return "passing"
  if (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure"
  ) {
    return "failing"
  }
  return "neutral"
}

const statusChecks = (state: string): ChecksStatus | null => {
  if (state === "pending") return "pending"
  if (state === "success") return "passing"
  if (state === "failure" || state === "error") return "failing"
  return null
}

const repositoryMetadata = (
  repository: typeof RepositoryPayload.Type.repository
): { owner: string; name: string; defaultBranch: string } | null => {
  if (
    repository.name === undefined ||
    repository.owner === undefined ||
    repository.default_branch === undefined
  ) {
    return null
  }
  return {
    owner: repository.owner.login,
    name: repository.name,
    defaultBranch: repository.default_branch
  }
}

const parseJson = (body: string) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(body)

const logIgnored = (
  message: string,
  delivery: GitHubWebhookDelivery,
  extra: Record<string, unknown> = {}
) =>
  Effect.logDebug(message).pipe(
    Effect.annotateLogs({
      module: "GitHubWebhooks",
      event: delivery.event,
      deliveryId: delivery.deliveryId,
      ...extra
    })
  )

const logMalformed = (
  delivery: GitHubWebhookDelivery,
  reason: string,
  extra: Record<string, unknown> = {}
) =>
  Effect.logWarning("github webhook payload ignored").pipe(
    Effect.annotateLogs({
      module: "GitHubWebhooks",
      event: delivery.event,
      deliveryId: delivery.deliveryId,
      reason,
      ...extra
    })
  )

const decodePayload = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  delivery: GitHubWebhookDelivery
): Effect.Effect<S["Type"] | null> =>
  Effect.gen(function* () {
    const json = yield* parseJson(delivery.body).pipe(Effect.result)
    if (json._tag === "Failure") {
      yield* logMalformed(delivery, "invalid_json")
      return null
    }
    const decoded = Schema.decodeUnknownExit(schema)(json.success)
    if (decoded._tag === "Failure") {
      yield* logMalformed(delivery, "invalid_payload")
      return null
    }
    return decoded.value
  })

const handleInstallation = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(InstallationPayload, delivery)
    if (!payload) return
    const installationId = idToString(payload.installation.id)
    if (payload.action === "deleted") {
      yield* sink.installationDeleted(installationId, delivery.deliveryId)
      return
    }
    if (payload.action === "suspend") {
      yield* sink.installationSuspended(installationId, delivery.deliveryId)
      return
    }
    if (payload.action === "unsuspend") {
      yield* sink.installationUnsuspended(installationId, delivery.deliveryId)
      return
    }
    yield* logIgnored("github webhook action ignored", delivery, {
      action: payload.action,
      installationId
    })
  })

const handleInstallationRepositories = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(
      InstallationRepositoriesPayload,
      delivery
    )
    if (!payload) return
    const installationId = idToString(payload.installation.id)
    if (payload.action !== "removed") {
      yield* logIgnored("github webhook action ignored", delivery, {
        action: payload.action,
        installationId
      })
      return
    }
    const repoIds = payload.repositories_removed.map((repo) =>
      idToString(repo.id)
    )
    yield* sink.repositoriesRemoved(
      installationId,
      repoIds,
      delivery.deliveryId
    )
  })

const pullRequestAction = (
  action: string
): "opened" | "reopened" | "synchronize" | "closed" | null => {
  if (
    action === "opened" ||
    action === "reopened" ||
    action === "synchronize" ||
    action === "closed"
  ) {
    return action
  }
  return null
}

const handlePullRequest = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(PullRequestPayload, delivery)
    if (!payload) return
    const action = pullRequestAction(payload.action)
    const installationId = idToString(payload.installation.id)
    const repositoryId = idToString(payload.repository.id)
    if (!action) {
      yield* logIgnored("github webhook action ignored", delivery, {
        action: payload.action,
        installationId,
        repositoryId
      })
      return
    }
    const headRepoId = idToString(payload.pull_request.head.repo.id)
    if (headRepoId !== repositoryId) {
      yield* logIgnored("github pull_request from fork ignored", delivery, {
        action,
        installationId,
        repositoryId,
        headRepoId
      })
      return
    }
    yield* sink.pullRequestChanged(
      {
        installationId,
        repositoryId,
        branch: payload.pull_request.head.ref,
        number: payload.number,
        state:
          action === "closed"
            ? payload.pull_request.merged
              ? "merged"
              : "closed"
            : "open"
      },
      delivery.deliveryId
    )
  })

const handleDelete = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(DeletePayload, delivery)
    if (!payload) return
    const installationId = idToString(payload.installation.id)
    const repositoryId = idToString(payload.repository.id)
    if (payload.ref_type !== "branch") {
      yield* logIgnored("github delete ref_type ignored", delivery, {
        refType: payload.ref_type,
        installationId,
        repositoryId
      })
      return
    }
    if (
      payload.repository.default_branch !== undefined &&
      payload.ref === payload.repository.default_branch
    ) {
      yield* logIgnored("github delete default branch ignored", delivery, {
        branch: payload.ref,
        installationId,
        repositoryId
      })
      return
    }
    yield* sink.branchDeleted(
      { installationId, repositoryId, branch: payload.ref },
      delivery.deliveryId
    )
  })

const handleCheckSuite = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(CheckSuitePayload, delivery)
    if (!payload) return
    const installationId = idToString(payload.installation.id)
    const repositoryId = idToString(payload.repository.id)
    const branch = payload.check_suite.head_branch
    if (!branch) {
      yield* logIgnored(
        "github check_suite without head branch ignored",
        delivery,
        {
          installationId,
          repositoryId
        }
      )
      return
    }
    yield* sink.checkStateChanged(
      {
        installationId,
        repositoryId,
        branch,
        headSha: payload.check_suite.head_sha,
        checks: checkSuiteChecks(
          payload.check_suite.status,
          payload.check_suite.conclusion
        ),
        updatedAt: payload.check_suite.updated_at
      },
      delivery.deliveryId
    )
  })

const handleStatus = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(StatusPayload, delivery)
    if (!payload) return
    const installationId = idToString(payload.installation.id)
    const repositoryId = idToString(payload.repository.id)
    const checks = statusChecks(payload.state)
    if (!checks) {
      yield* logIgnored("github status state ignored", delivery, {
        state: payload.state,
        installationId,
        repositoryId
      })
      return
    }
    const branches = payload.branches.filter(
      (entry) => entry.commit.sha === payload.sha
    )
    if (branches.length === 0) {
      yield* logIgnored(
        "github status without matching branch ignored",
        delivery,
        {
          installationId,
          repositoryId,
          sha: payload.sha
        }
      )
      return
    }
    yield* Effect.forEach(
      branches,
      (entry) =>
        sink.checkStateChanged(
          {
            installationId,
            repositoryId,
            branch: entry.name,
            headSha: payload.sha,
            checks,
            updatedAt: payload.updated_at
          },
          delivery.deliveryId
        ),
      { concurrency: 1 }
    )
  })

const handleRepository = (
  sink: GitHubWebhookMutationSink,
  delivery: GitHubWebhookDelivery
) =>
  Effect.gen(function* () {
    const payload = yield* decodePayload(RepositoryPayload, delivery)
    if (!payload) return
    const installationId = idToString(payload.installation.id)
    const repoId = idToString(payload.repository.id)
    if (payload.action === "archived") {
      yield* sink.repositoryArchived(
        installationId,
        repoId,
        delivery.deliveryId
      )
      return
    }
    if (payload.action === "unarchived") {
      yield* sink.repositoryUnarchived(
        installationId,
        repoId,
        delivery.deliveryId
      )
      return
    }
    if (payload.action === "deleted") {
      yield* sink.repositoryDeleted(installationId, repoId, delivery.deliveryId)
      return
    }
    if (payload.action === "renamed" || payload.action === "transferred") {
      const metadata = repositoryMetadata(payload.repository)
      if (!metadata) {
        yield* logMalformed(delivery, "invalid_payload", {
          action: payload.action,
          installationId,
          repoId
        })
        return
      }
      const change = { installationId, repoId, ...metadata }
      yield* payload.action === "renamed"
        ? sink.repositoryRenamed(change, delivery.deliveryId)
        : sink.repositoryTransferred(change, delivery.deliveryId)
      return
    }
    yield* logIgnored("github webhook action ignored", delivery, {
      action: payload.action,
      installationId,
      repoId
    })
  })

export const makeGitHubWebhooks = (
  sink: GitHubWebhookMutationSink
): GitHubWebhooksShape => ({
  handle: Effect.fn("GitHubWebhooks.handle")(function* (
    delivery: GitHubWebhookDelivery
  ) {
    if (delivery.event === "installation") {
      yield* handleInstallation(sink, delivery)
      return
    }
    if (delivery.event === "installation_repositories") {
      yield* handleInstallationRepositories(sink, delivery)
      return
    }
    if (delivery.event === "pull_request") {
      yield* handlePullRequest(sink, delivery)
      return
    }
    if (delivery.event === "repository") {
      yield* handleRepository(sink, delivery)
      return
    }
    if (delivery.event === "delete") {
      yield* handleDelete(sink, delivery)
      return
    }
    if (delivery.event === "check_suite") {
      yield* handleCheckSuite(sink, delivery)
      return
    }
    if (delivery.event === "status") {
      yield* handleStatus(sink, delivery)
      return
    }
    yield* logIgnored("github webhook event ignored", delivery)
  })
})

const disconnectMessage = "GitHub App installation removed"
const suspendMessage = "GitHub App installation suspended"
const repositoryArchivedMessage = "GitHub repository archived"
const repositoryTransferredMessage = "GitHub repository transferred"

export const GitHubWebhooksLive = Layer.effect(
  GitHubWebhooks,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const ticketDocs = yield* TicketDocs
    const ticketIndex = yield* TicketIndex
    const ticketDocumentLock = yield* TicketDocumentLock.TicketDocumentLock
    const projectStateCache = yield* ProjectStateCache.ProjectStateCache

    const withProjectStateInvalidation = <A, E>(
      installationId: string,
      effect: Effect.Effect<A, E>
    ): Effect.Effect<A, E> =>
      Effect.ensuring(
        effect,
        projectStateCache.invalidateForInstallation(installationId)
      )

    const installationRow = Effect.fn("GitHubWebhooks.installationRow")(
      function* (installationId: string) {
        const rows = yield* db
          .select({
            integrationId: organizationIntegration.id,
            organizationId: organizationIntegration.organizationId
          })
          .from(organizationGithubIntegration)
          .innerJoin(
            organizationIntegration,
            eq(
              organizationIntegration.id,
              organizationGithubIntegration.organizationIntegrationId
            )
          )
          .where(
            eq(organizationGithubIntegration.installationId, installationId)
          )
          .limit(1)
          .pipe(Effect.orDie)
        return rows[0] ?? null
      }
    )

    const updateProjectRepositories = (
      linkIds: ReadonlyArray<string>,
      status: "active" | "broken" | "disconnected",
      currentStatuses: ReadonlyArray<"active" | "broken" | "disconnected">
    ) =>
      linkIds.length === 0
        ? Effect.void
        : db
            .update(projectGithubRepository)
            .set({ status })
            .where(
              and(
                inArray(projectGithubRepository.projectIntegrationLinkId, [
                  ...linkIds
                ]),
                inArray(projectGithubRepository.status, [...currentStatuses])
              )
            )
            .pipe(Effect.orDie)

    const updateProjectLinks = Effect.fn("GitHubWebhooks.updateProjectLinks")(
      function* (
        integrationId: string,
        status: "active" | "broken" | "disconnected",
        currentStatuses: ReadonlyArray<"active" | "broken" | "disconnected">,
        now: Date,
        lastCheckStatus: "ok" | "error",
        lastCheckError: string | null
      ) {
        const links = yield* db
          .update(projectIntegrationLink)
          .set({
            status,
            disconnectedAt: status === "disconnected" ? now : null,
            lastCheckedAt: now,
            lastCheckStatus,
            lastCheckError,
            updatedAt: now
          })
          .where(
            and(
              eq(
                projectIntegrationLink.organizationIntegrationId,
                integrationId
              ),
              inArray(projectIntegrationLink.status, [...currentStatuses])
            )
          )
          .returning({ id: projectIntegrationLink.id })
          .pipe(Effect.orDie)
        yield* updateProjectRepositories(
          links.map((link) => link.id),
          status,
          currentStatuses
        )
      }
    )

    const updateInstallation = Effect.fn("GitHubWebhooks.updateInstallation")(
      function* (
        installationId: string,
        status: "active" | "broken" | "disconnected",
        currentStatuses: ReadonlyArray<"active" | "broken" | "disconnected">,
        message: string | null,
        deliveryId: string | null
      ) {
        const row = yield* installationRow(installationId)
        if (!row) {
          yield* Effect.logDebug("github webhook installation unknown").pipe(
            Effect.annotateLogs({
              module: "GitHubWebhooks",
              installationId,
              deliveryId
            })
          )
          return
        }
        const now = yield* DateTime.nowAsDate
        const lastCheckStatus = status === "broken" ? "error" : "ok"
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* db
                .update(organizationIntegration)
                .set({
                  status,
                  disconnectedAt: status === "disconnected" ? now : null,
                  lastCheckedAt: now,
                  lastCheckStatus,
                  lastCheckError: message,
                  updatedAt: now
                })
                .where(
                  and(
                    eq(organizationIntegration.id, row.integrationId),
                    inArray(organizationIntegration.status, [
                      ...currentStatuses
                    ])
                  )
                )
                .pipe(Effect.orDie)
              yield* updateProjectLinks(
                row.integrationId,
                status,
                currentStatuses,
                now,
                lastCheckStatus,
                message
              )
              if (status === "disconnected") {
                yield* db
                  .delete(organizationGithubIntegration)
                  .where(
                    eq(
                      organizationGithubIntegration.organizationIntegrationId,
                      row.integrationId
                    )
                  )
                  .pipe(Effect.orDie)
              }
            })
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      }
    )

    const repositoriesRemoved = Effect.fn("GitHubWebhooks.repositoriesRemoved")(
      function* (
        installationId: string,
        repoIds: ReadonlyArray<string>,
        _deliveryId: string | null
      ) {
        if (repoIds.length === 0) return
        const row = yield* installationRow(installationId)
        if (!row) {
          yield* Effect.logDebug("github webhook installation unknown").pipe(
            Effect.annotateLogs({
              module: "GitHubWebhooks",
              installationId,
              deliveryId: _deliveryId
            })
          )
          return
        }
        const now = yield* DateTime.nowAsDate
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const links = yield* db
                .select({ id: projectIntegrationLink.id })
                .from(projectGithubRepository)
                .innerJoin(
                  projectIntegrationLink,
                  eq(
                    projectIntegrationLink.id,
                    projectGithubRepository.projectIntegrationLinkId
                  )
                )
                .where(
                  and(
                    eq(
                      projectIntegrationLink.organizationIntegrationId,
                      row.integrationId
                    ),
                    eq(
                      projectGithubRepository.organizationId,
                      row.organizationId
                    ),
                    inArray(projectGithubRepository.repoId, [...repoIds]),
                    inArray(projectGithubRepository.status, [
                      "active",
                      "broken"
                    ]),
                    inArray(projectIntegrationLink.status, ["active", "broken"])
                  )
                )
                .pipe(Effect.orDie)
              const linkIds = links.map((link) => link.id)
              if (linkIds.length === 0) return
              yield* db
                .update(projectIntegrationLink)
                .set({
                  status: "disconnected",
                  disconnectedAt: now,
                  lastCheckedAt: now,
                  lastCheckStatus: "ok",
                  lastCheckError: null,
                  updatedAt: now
                })
                .where(inArray(projectIntegrationLink.id, linkIds))
                .pipe(Effect.orDie)
              yield* updateProjectRepositories(linkIds, "disconnected", [
                "active",
                "broken"
              ])
            })
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      }
    )

    const connectedRepoLinks = Effect.fn("GitHubWebhooks.connectedRepoLinks")(
      function* (
        integrationId: string,
        organizationId: string,
        repoId: string,
        currentStatuses: ReadonlyArray<"active" | "broken" | "disconnected">
      ) {
        const rows = yield* db
          .select({ id: projectIntegrationLink.id })
          .from(projectGithubRepository)
          .innerJoin(
            projectIntegrationLink,
            eq(
              projectIntegrationLink.id,
              projectGithubRepository.projectIntegrationLinkId
            )
          )
          .where(
            and(
              eq(
                projectIntegrationLink.organizationIntegrationId,
                integrationId
              ),
              eq(projectGithubRepository.organizationId, organizationId),
              eq(projectGithubRepository.repoId, repoId),
              inArray(projectGithubRepository.status, [...currentStatuses]),
              inArray(projectIntegrationLink.status, [...currentStatuses])
            )
          )
          .pipe(Effect.orDie)
        return rows.map((row) => row.id)
      }
    )

    const writeRepositoryMetadata = (
      linkIds: ReadonlyArray<string>,
      change: GitHubRepositoryMetadataChange
    ) =>
      linkIds.length === 0
        ? Effect.void
        : db
            .update(projectGithubRepository)
            .set({
              repoOwner: change.owner,
              repoName: change.name,
              defaultBranch: change.defaultBranch
            })
            .where(
              inArray(projectGithubRepository.projectIntegrationLinkId, [
                ...linkIds
              ])
            )
            .pipe(Effect.orDie)

    const setRepositoryConnectionStatus = Effect.fn(
      "GitHubWebhooks.setRepositoryConnectionStatus"
    )(function* (
      installationId: string,
      repoId: string,
      status: "active" | "broken" | "disconnected",
      currentStatuses: ReadonlyArray<"active" | "broken" | "disconnected">,
      message: string | null,
      deliveryId: string | null
    ) {
      const row = yield* installationRow(installationId)
      if (!row) {
        yield* Effect.logDebug("github webhook installation unknown").pipe(
          Effect.annotateLogs({
            module: "GitHubWebhooks",
            installationId,
            deliveryId
          })
        )
        return
      }
      const now = yield* DateTime.nowAsDate
      const lastCheckStatus = status === "broken" ? "error" : "ok"
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const linkIds = yield* connectedRepoLinks(
              row.integrationId,
              row.organizationId,
              repoId,
              currentStatuses
            )
            if (linkIds.length === 0) return
            yield* db
              .update(projectIntegrationLink)
              .set({
                status,
                disconnectedAt: status === "disconnected" ? now : null,
                lastCheckedAt: now,
                lastCheckStatus,
                lastCheckError: message,
                updatedAt: now
              })
              .where(inArray(projectIntegrationLink.id, linkIds))
              .pipe(Effect.orDie)
            yield* updateProjectRepositories(linkIds, status, currentStatuses)
          })
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const repositoryRenamed = Effect.fn("GitHubWebhooks.repositoryRenamed")(
      function* (
        change: GitHubRepositoryMetadataChange,
        deliveryId: string | null
      ) {
        const row = yield* installationRow(change.installationId)
        if (!row) {
          yield* Effect.logDebug("github webhook installation unknown").pipe(
            Effect.annotateLogs({
              module: "GitHubWebhooks",
              installationId: change.installationId,
              deliveryId
            })
          )
          return
        }
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const linkIds = yield* connectedRepoLinks(
                row.integrationId,
                row.organizationId,
                change.repoId,
                ["active", "broken"]
              )
              yield* writeRepositoryMetadata(linkIds, change)
            })
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      }
    )

    const repositoryTransferred = Effect.fn(
      "GitHubWebhooks.repositoryTransferred"
    )(function* (
      change: GitHubRepositoryMetadataChange,
      _deliveryId: string | null
    ) {
      const row = yield* installationRow(change.installationId)
      const now = yield* DateTime.nowAsDate
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            const matches = yield* db
              .select({
                id: projectIntegrationLink.id,
                organizationIntegrationId:
                  projectIntegrationLink.organizationIntegrationId
              })
              .from(projectGithubRepository)
              .innerJoin(
                projectIntegrationLink,
                eq(
                  projectIntegrationLink.id,
                  projectGithubRepository.projectIntegrationLinkId
                )
              )
              .where(
                and(
                  eq(projectGithubRepository.repoId, change.repoId),
                  inArray(projectGithubRepository.status, ["active", "broken"]),
                  inArray(projectIntegrationLink.status, ["active", "broken"])
                )
              )
              .pipe(Effect.orDie)
            const retained = row
              ? matches.filter(
                  (match) =>
                    match.organizationIntegrationId === row.integrationId
                )
              : []
            const lost = matches.filter(
              (match) =>
                !row || match.organizationIntegrationId !== row.integrationId
            )
            yield* writeRepositoryMetadata(
              retained.map((match) => match.id),
              change
            )
            const lostIds = lost.map((match) => match.id)
            if (lostIds.length > 0) {
              yield* db
                .update(projectIntegrationLink)
                .set({
                  status: "broken",
                  disconnectedAt: null,
                  lastCheckedAt: now,
                  lastCheckStatus: "error",
                  lastCheckError: repositoryTransferredMessage,
                  updatedAt: now
                })
                .where(inArray(projectIntegrationLink.id, lostIds))
                .pipe(Effect.orDie)
              yield* updateProjectRepositories(lostIds, "broken", [
                "active",
                "broken"
              ])
            }
          })
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const activeProjectLinksForRepository = Effect.fn(
      "GitHubWebhooks.activeProjectLinksForRepository"
    )(function* (change: {
      readonly installationId: string
      readonly repositoryId: string
    }) {
      return yield* db
        .select({
          id: projectIntegrationLink.id,
          projectId: projectIntegrationLink.projectId
        })
        .from(projectGithubRepository)
        .innerJoin(
          projectIntegrationLink,
          eq(
            projectIntegrationLink.id,
            projectGithubRepository.projectIntegrationLinkId
          )
        )
        .innerJoin(
          organizationIntegration,
          eq(
            organizationIntegration.id,
            projectIntegrationLink.organizationIntegrationId
          )
        )
        .innerJoin(
          organizationGithubIntegration,
          eq(
            organizationGithubIntegration.organizationIntegrationId,
            organizationIntegration.id
          )
        )
        .where(
          and(
            eq(
              organizationGithubIntegration.installationId,
              change.installationId
            ),
            eq(projectGithubRepository.repoId, change.repositoryId),
            eq(organizationIntegration.status, "active"),
            eq(projectIntegrationLink.status, "active"),
            eq(projectGithubRepository.status, "active")
          )
        )
        .pipe(Effect.orDie)
    })

    const pullRequestChanged = Effect.fn("GitHubWebhooks.pullRequestChanged")(
      function* (
        change: GitHubPullRequestWebhookChange,
        deliveryId: string | null
      ) {
        const links = yield* activeProjectLinksForRepository(change)
        if (links.length === 0) {
          yield* Effect.logDebug("github pull_request repository unknown").pipe(
            Effect.annotateLogs({
              module: "GitHubWebhooks",
              deliveryId,
              installationId: change.installationId,
              repositoryId: change.repositoryId
            })
          )
          return
        }
        yield* Effect.forEach(
          links,
          (link) =>
            ticketIndex.findTicketsByBranch(link.projectId, change.branch).pipe(
              Effect.flatMap((matches) =>
                matches.length === 0
                  ? Effect.logDebug("github pull_request branch unknown").pipe(
                      Effect.annotateLogs({
                        module: "GitHubWebhooks",
                        deliveryId,
                        installationId: change.installationId,
                        repositoryId: change.repositoryId,
                        branch: change.branch,
                        projectIntegrationLinkId: link.id
                      })
                    )
                  : Effect.forEach(
                      matches,
                      (match) =>
                        applyPullRequestWebhookToTicket(
                          { ticketDocs, ticketIndex, ticketDocumentLock },
                          match,
                          change,
                          deliveryId
                        ),
                      { concurrency: 1 }
                    ).pipe(Effect.asVoid)
              )
            ),
          { concurrency: 1 }
        )
      }
    )

    const branchDeleted = Effect.fn("GitHubWebhooks.branchDeleted")(function* (
      change: GitHubBranchDeletionChange,
      deliveryId: string | null
    ) {
      const links = yield* activeProjectLinksForRepository(change)
      if (links.length === 0) {
        yield* Effect.logDebug("github delete repository unknown").pipe(
          Effect.annotateLogs({
            module: "GitHubWebhooks",
            deliveryId,
            installationId: change.installationId,
            repositoryId: change.repositoryId
          })
        )
        return
      }
      const now = yield* DateTime.nowAsDate
      yield* sql
        .withTransaction(
          Effect.forEach(
            links,
            (link) =>
              ticketIndex
                .markBranchStale(link.projectId, change.branch, now)
                .pipe(
                  Effect.flatMap((ticketIds) =>
                    ticketIds.length === 0
                      ? Effect.logDebug("github delete branch unknown").pipe(
                          Effect.annotateLogs({
                            module: "GitHubWebhooks",
                            deliveryId,
                            installationId: change.installationId,
                            repositoryId: change.repositoryId,
                            branch: change.branch,
                            projectIntegrationLinkId: link.id
                          })
                        )
                      : Effect.logInfo(
                          "github delete branch marked stale"
                        ).pipe(
                          Effect.annotateLogs({
                            module: "GitHubWebhooks",
                            deliveryId,
                            installationId: change.installationId,
                            repositoryId: change.repositoryId,
                            branch: change.branch,
                            projectIntegrationLinkId: link.id,
                            ticketIds
                          })
                        )
                  )
                ),
            { concurrency: 1 }
          ).pipe(Effect.asVoid)
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))
    })

    const checkStateChanged = Effect.fn("GitHubWebhooks.checkStateChanged")(
      function* (change: GitHubCheckWebhookChange, deliveryId: string | null) {
        const links = yield* activeProjectLinksForRepository(change)
        if (links.length === 0) {
          yield* Effect.logDebug("github check repository unknown").pipe(
            Effect.annotateLogs({
              module: "GitHubWebhooks",
              deliveryId,
              installationId: change.installationId,
              repositoryId: change.repositoryId
            })
          )
          return
        }
        yield* sql
          .withTransaction(
            Effect.forEach(
              links,
              (link) =>
                ticketIndex
                  .updateBranchChecks(
                    link.projectId,
                    change.branch,
                    change.checks,
                    change.headSha,
                    change.updatedAt
                  )
                  .pipe(
                    Effect.flatMap((ticketIds) =>
                      ticketIds.length === 0
                        ? Effect.logDebug(
                            "github check branch unknown or stale"
                          ).pipe(
                            Effect.annotateLogs({
                              module: "GitHubWebhooks",
                              deliveryId,
                              installationId: change.installationId,
                              repositoryId: change.repositoryId,
                              branch: change.branch,
                              projectIntegrationLinkId: link.id
                            })
                          )
                        : Effect.logInfo("github check state updated").pipe(
                            Effect.annotateLogs({
                              module: "GitHubWebhooks",
                              deliveryId,
                              installationId: change.installationId,
                              repositoryId: change.repositoryId,
                              branch: change.branch,
                              projectIntegrationLinkId: link.id,
                              checks: change.checks,
                              ticketIds
                            })
                          )
                    )
                  ),
              { concurrency: 1 }
            ).pipe(Effect.asVoid)
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      }
    )

    return makeGitHubWebhooks({
      installationDeleted: (installationId, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          updateInstallation(
            installationId,
            "disconnected",
            ["active", "broken"],
            disconnectMessage,
            deliveryId
          )
        ),
      installationSuspended: (installationId, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          updateInstallation(
            installationId,
            "broken",
            ["active", "broken"],
            suspendMessage,
            deliveryId
          )
        ),
      installationUnsuspended: (installationId, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          updateInstallation(
            installationId,
            "active",
            ["broken"],
            null,
            deliveryId
          )
        ),
      repositoriesRemoved: (installationId, repoIds, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          repositoriesRemoved(installationId, repoIds, deliveryId)
        ),
      repositoryRenamed: (change, deliveryId) =>
        withProjectStateInvalidation(
          change.installationId,
          repositoryRenamed(change, deliveryId)
        ),
      repositoryTransferred: (change, deliveryId) =>
        withProjectStateInvalidation(
          change.installationId,
          repositoryTransferred(change, deliveryId)
        ),
      repositoryArchived: (installationId, repoId, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          setRepositoryConnectionStatus(
            installationId,
            repoId,
            "broken",
            ["active"],
            repositoryArchivedMessage,
            deliveryId
          )
        ),
      repositoryUnarchived: (installationId, repoId, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          setRepositoryConnectionStatus(
            installationId,
            repoId,
            "active",
            ["broken"],
            null,
            deliveryId
          )
        ),
      repositoryDeleted: (installationId, repoId, deliveryId) =>
        withProjectStateInvalidation(
          installationId,
          setRepositoryConnectionStatus(
            installationId,
            repoId,
            "disconnected",
            ["active", "broken"],
            null,
            deliveryId
          )
        ),
      pullRequestChanged: (change, deliveryId) =>
        withProjectStateInvalidation(
          change.installationId,
          pullRequestChanged(change, deliveryId)
        ),
      branchDeleted: (change, deliveryId) =>
        withProjectStateInvalidation(
          change.installationId,
          branchDeleted(change, deliveryId)
        ),
      checkStateChanged: (change, deliveryId) =>
        withProjectStateInvalidation(
          change.installationId,
          checkStateChanged(change, deliveryId)
        )
    })
  })
)

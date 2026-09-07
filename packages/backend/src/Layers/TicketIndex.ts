import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm"
import {
  NotFound,
  TagName,
  TicketId,
  type ChecksStatus,
  type PullRequestState,
  type TicketPriority,
  type TicketStatus,
  type TicketType
} from "@projectproject/shared"
import type { MarkdownError } from "../Services/Markdown"
import { organization, projectIndex, ticketIndex } from "../db/schema"
import { Db } from "../Services/Db"
import {
  TicketIndex,
  type TicketIndexDrift,
  type TicketIndexEntry,
  type TicketIndexProject,
  type TicketIndexReconcileOptions,
  type TicketIndexReconcileProjectSummary,
  type TicketIndexReconcileSummary
} from "../Services/TicketIndex"
import { TicketDocs, type TicketDocument } from "../Services/TicketDocs"

const makeTicketId = Schema.decodeUnknownSync(TicketId)
const makeTagName = Schema.decodeUnknownSync(TagName)

export interface IndexedTicketRef {
  readonly ticketId: string
  readonly updatedAt: Date
}

export interface DocumentTicketRef {
  readonly id: string
  readonly updatedAt: Date
}

export const detectTicketIndexDrift = (
  indexed: ReadonlyArray<IndexedTicketRef>,
  documents: ReadonlyArray<DocumentTicketRef>
): TicketIndexDrift => {
  const indexedTimes = new Map(
    indexed.map((row) => [row.ticketId, row.updatedAt.getTime()])
  )
  const documentTimes = new Map(
    documents.map((doc) => [doc.id, doc.updatedAt.getTime()])
  )
  const missing: Array<string> = []
  const stale: Array<string> = []
  for (const [id, time] of documentTimes) {
    const indexedTime = indexedTimes.get(id)
    if (indexedTime === undefined) missing.push(id)
    else if (indexedTime !== time) stale.push(id)
  }
  const orphaned: Array<string> = []
  for (const id of indexedTimes.keys()) {
    if (!documentTimes.has(id)) orphaned.push(id)
  }
  return {
    missing: missing.sort(),
    orphaned: orphaned.sort(),
    stale: stale.sort()
  }
}

export const ticketIndexHasDrift = (drift: TicketIndexDrift): boolean =>
  drift.missing.length > 0 ||
  drift.orphaned.length > 0 ||
  drift.stale.length > 0

export interface TicketIndexReconcilerDeps {
  readonly listProjects: Effect.Effect<ReadonlyArray<TicketIndexProject>>
  readonly collectDocuments: (
    project: TicketIndexProject
  ) => Effect.Effect<
    { documents: ReadonlyArray<TicketDocument>; skipped: number },
    MarkdownError
  >
  readonly indexedRefs: (
    project: TicketIndexProject
  ) => Effect.Effect<ReadonlyArray<IndexedTicketRef>>
  readonly writeProject: (
    project: TicketIndexProject,
    documents: ReadonlyArray<TicketDocument>
  ) => Effect.Effect<void>
}

export const makeTicketIndexReconciler = (deps: TicketIndexReconcilerDeps) => {
  const reconcileProject = (
    project: TicketIndexProject,
    options?: TicketIndexReconcileOptions
  ): Effect.Effect<TicketIndexReconcileProjectSummary, MarkdownError> =>
    Effect.gen(function* () {
      const { documents, skipped } = yield* deps.collectDocuments(project)
      const indexed = yield* deps.indexedRefs(project)
      const drift = detectTicketIndexDrift(
        indexed,
        documents.map((doc) => ({ id: doc.id, updatedAt: doc.updatedAt }))
      )
      const shouldRebuild =
        (options?.force ?? false) || ticketIndexHasDrift(drift)
      if (!shouldRebuild) {
        return {
          project,
          drift,
          rebuilt: false,
          indexed: indexed.length,
          skipped
        }
      }
      if (ticketIndexHasDrift(drift)) {
        yield* Effect.logWarning("ticket index drift detected; rebuilding", {
          orgSlug: project.orgSlug,
          slug: project.projectSlug,
          projectId: project.projectId,
          missing: drift.missing,
          orphaned: drift.orphaned,
          stale: drift.stale,
          indexedCount: indexed.length,
          documentCount: documents.length
        })
      }
      yield* deps.writeProject(project, documents)
      return {
        project,
        drift,
        rebuilt: true,
        indexed: documents.length,
        skipped
      }
    })

  const reconcileAllProjects = (): Effect.Effect<
    TicketIndexReconcileSummary,
    MarkdownError
  > =>
    Effect.gen(function* () {
      const projects = yield* deps.listProjects
      const summaries = yield* Effect.forEach(
        projects,
        (project) => reconcileProject(project),
        { concurrency: 1 }
      )
      return {
        projects: summaries,
        reconciled: summaries.filter((summary) => summary.rebuilt).length
      }
    })

  return { reconcileProject, reconcileAllProjects }
}

export const TicketIndexLive = Layer.effect(
  TicketIndex,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const ticketDocs = yield* TicketDocs

    const projectFor = (
      orgSlug: string,
      slug: string
    ): Effect.Effect<TicketIndexProject, NotFound> =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            orgSlug: organization.slug,
            organizationId: projectIndex.organizationId,
            projectId: projectIndex.id,
            projectSlug: projectIndex.slug
          })
          .from(projectIndex)
          .innerJoin(
            organization,
            eq(organization.id, projectIndex.organizationId)
          )
          .where(
            and(eq(organization.slug, orgSlug), eq(projectIndex.slug, slug))
          )
          .limit(1)
          .pipe(Effect.orDie)
        const row = rows[0]
        return row ?? (yield* new NotFound())
      })

    const rowFor = (project: TicketIndexProject, document: TicketDocument) => ({
      organizationId: project.organizationId,
      orgSlug: project.orgSlug,
      projectId: project.projectId,
      projectSlug: project.projectSlug,
      ticketId: document.id,
      title: document.title,
      status: document.status,
      type: document.type,
      priority: document.priority,
      tags: [...document.tags],
      assignees: [...document.assignees],
      branch: document.branch,
      pr: document.pr,
      prState: document.prState,
      lastTransitionedPr: document.lastTransitionedPr,
      archivedAt: document.archivedAt,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt
    })

    const toEntry = (
      row: typeof ticketIndex.$inferSelect
    ): TicketIndexEntry => ({
      id: makeTicketId(row.ticketId),
      title: row.title,
      status: row.status as TicketStatus,
      type: row.type as TicketType,
      priority: row.priority as TicketPriority,
      tags: row.tags.map((tag) => makeTagName(tag)),
      branch: row.branch,
      pr: row.pr,
      prState: row.prState as PullRequestState | null,
      lastTransitionedPr: row.lastTransitionedPr,
      branchDeletedAt: row.branchDeletedAt,
      checks: row.checks as ChecksStatus | null,
      checksHeadSha: row.checksHeadSha,
      checksUpdatedAt: row.checksUpdatedAt,
      assignees: row.assignees,
      archivedAt: row.archivedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    })

    const list = (
      project: TicketIndexProject,
      ticketIds?: ReadonlyArray<string>
    ): Effect.Effect<ReadonlyArray<TicketIndexEntry>> => {
      if (ticketIds !== undefined && ticketIds.length === 0) {
        return Effect.succeed([])
      }
      const where =
        ticketIds === undefined
          ? eq(ticketIndex.projectId, project.projectId)
          : and(
              eq(ticketIndex.projectId, project.projectId),
              inArray(ticketIndex.ticketId, [...ticketIds])
            )
      return db
        .select()
        .from(ticketIndex)
        .where(where)
        .pipe(
          Effect.map((rows) => rows.map(toEntry)),
          Effect.orDie
        )
    }

    const listIds = (
      project: TicketIndexProject
    ): Effect.Effect<ReadonlyArray<string>> =>
      db
        .select({ ticketId: ticketIndex.ticketId })
        .from(ticketIndex)
        .where(eq(ticketIndex.projectId, project.projectId))
        .pipe(
          Effect.map((rows) => rows.map((row) => row.ticketId)),
          Effect.orDie
        )

    const tagUsageCounts = (
      project: TicketIndexProject
    ): Effect.Effect<Readonly<Record<string, number>>> =>
      db
        .select({ tags: ticketIndex.tags })
        .from(ticketIndex)
        .where(eq(ticketIndex.projectId, project.projectId))
        .pipe(
          Effect.map((rows) => {
            const counts: Record<string, number> = {}
            for (const row of rows) {
              for (const tag of row.tags) counts[tag] = (counts[tag] ?? 0) + 1
            }
            return counts
          }),
          Effect.orDie
        )

    const findTicketIdsByTag = (
      project: TicketIndexProject,
      tag: string
    ): Effect.Effect<ReadonlyArray<string>> =>
      db
        .select({ ticketId: ticketIndex.ticketId, tags: ticketIndex.tags })
        .from(ticketIndex)
        .where(eq(ticketIndex.projectId, project.projectId))
        .pipe(
          Effect.map((rows) =>
            rows
              .filter((row) => row.tags.includes(tag))
              .map((row) => row.ticketId)
          ),
          Effect.orDie
        )

    const findTicketIdsByStatus = (
      project: TicketIndexProject,
      status: string
    ): Effect.Effect<ReadonlyArray<string>> =>
      db
        .select({ ticketId: ticketIndex.ticketId })
        .from(ticketIndex)
        .where(
          and(
            eq(ticketIndex.projectId, project.projectId),
            eq(ticketIndex.status, status)
          )
        )
        .pipe(
          Effect.map((rows) => rows.map((r) => r.ticketId)),
          Effect.orDie
        )

    const findTicketsByBranch = (
      projectId: string,
      branch: string
    ): Effect.Effect<
      ReadonlyArray<{
        readonly orgSlug: string
        readonly organizationId: string
        readonly projectId: string
        readonly projectSlug: string
        readonly ticketId: string
        readonly branch: string
      }>
    > =>
      db
        .select({
          orgSlug: ticketIndex.orgSlug,
          organizationId: ticketIndex.organizationId,
          projectId: ticketIndex.projectId,
          projectSlug: ticketIndex.projectSlug,
          ticketId: ticketIndex.ticketId,
          branch: ticketIndex.branch
        })
        .from(ticketIndex)
        .where(
          and(
            eq(ticketIndex.projectId, projectId),
            eq(ticketIndex.branch, branch)
          )
        )
        .pipe(
          Effect.map((rows) =>
            rows.flatMap((row) =>
              row.branch === null ? [] : [{ ...row, branch: row.branch }]
            )
          ),
          Effect.orDie
        )

    const upsertTicket = (
      project: TicketIndexProject,
      document: TicketDocument
    ): Effect.Effect<void> =>
      db
        .insert(ticketIndex)
        .values(rowFor(project, document))
        .onConflictDoUpdate({
          target: [ticketIndex.projectId, ticketIndex.ticketId],
          set: rowFor(project, document)
        })
        .pipe(Effect.asVoid, Effect.orDie)

    const markBranchStale = (
      projectId: string,
      branch: string,
      deletedAt: Date
    ): Effect.Effect<ReadonlyArray<string>> =>
      db
        .update(ticketIndex)
        .set({ branchDeletedAt: deletedAt })
        .where(
          and(
            eq(ticketIndex.projectId, projectId),
            eq(ticketIndex.branch, branch),
            isNull(ticketIndex.branchDeletedAt)
          )
        )
        .returning({ ticketId: ticketIndex.ticketId })
        .pipe(
          Effect.map((rows) => rows.map((row) => row.ticketId)),
          Effect.orDie
        )

    const clearBranchStale = (
      project: TicketIndexProject,
      ticketIds: ReadonlyArray<string>
    ): Effect.Effect<void> => {
      if (ticketIds.length === 0) return Effect.void
      return db
        .update(ticketIndex)
        .set({ branchDeletedAt: null })
        .where(
          and(
            eq(ticketIndex.projectId, project.projectId),
            inArray(ticketIndex.ticketId, [...ticketIds])
          )
        )
        .pipe(Effect.asVoid, Effect.orDie)
    }

    const updateBranchChecks = (
      projectId: string,
      branch: string,
      checks: ChecksStatus,
      headSha: string,
      updatedAt: Date
    ): Effect.Effect<ReadonlyArray<string>> =>
      db
        .update(ticketIndex)
        .set({ checks, checksHeadSha: headSha, checksUpdatedAt: updatedAt })
        .where(
          and(
            eq(ticketIndex.projectId, projectId),
            eq(ticketIndex.branch, branch),
            or(
              isNull(ticketIndex.checksUpdatedAt),
              lt(ticketIndex.checksUpdatedAt, updatedAt)
            )
          )
        )
        .returning({ ticketId: ticketIndex.ticketId })
        .pipe(
          Effect.map((rows) => rows.map((row) => row.ticketId)),
          Effect.orDie
        )

    const deleteTicket = (
      project: TicketIndexProject,
      ticketId: string
    ): Effect.Effect<void> =>
      db
        .delete(ticketIndex)
        .where(
          and(
            eq(ticketIndex.projectId, project.projectId),
            eq(ticketIndex.ticketId, ticketId)
          )
        )
        .pipe(Effect.asVoid, Effect.orDie)

    const collectDocuments = (project: TicketIndexProject) =>
      Effect.gen(function* () {
        const ids = yield* ticketDocs.listIds(
          project.orgSlug,
          project.projectSlug
        )
        const reads = yield* Effect.forEach(
          ids,
          (id) =>
            ticketDocs.read(project.orgSlug, project.projectSlug, id).pipe(
              Effect.map((ticket) => ({ ticket, skipped: false as const })),
              Effect.catchTag("MalformedTicketDocument", (error) =>
                Effect.logWarning(
                  "Skipping unreadable ticket for ticket index",
                  {
                    orgSlug: project.orgSlug,
                    slug: project.projectSlug,
                    ticketId: id,
                    error
                  }
                ).pipe(Effect.as({ ticket: null, skipped: true as const }))
              ),
              Effect.catchTag("NotFound", () =>
                Effect.logDebug("Skipping vanished ticket for ticket index", {
                  orgSlug: project.orgSlug,
                  slug: project.projectSlug,
                  ticketId: id
                }).pipe(Effect.as({ ticket: null, skipped: true as const }))
              )
            ),
          { concurrency: 8 }
        )
        const documents = reads.flatMap((read) =>
          read.ticket === null ? [] : [read.ticket]
        )
        const skipped = reads.filter((read) => read.skipped).length
        return { documents, skipped }
      })

    const writeProjectIndex = (
      project: TicketIndexProject,
      documents: ReadonlyArray<TicketDocument>
    ): Effect.Effect<void> =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* db
              .delete(ticketIndex)
              .where(eq(ticketIndex.projectId, project.projectId))
              .pipe(Effect.asVoid, Effect.orDie)
            if (documents.length > 0) {
              yield* db
                .insert(ticketIndex)
                .values(documents.map((document) => rowFor(project, document)))
                .pipe(Effect.asVoid, Effect.orDie)
            }
          })
        )
        .pipe(Effect.catchTag("SqlError", Effect.die), Effect.asVoid)

    const indexedRefs = (project: TicketIndexProject) =>
      db
        .select({
          ticketId: ticketIndex.ticketId,
          updatedAt: ticketIndex.updatedAt
        })
        .from(ticketIndex)
        .where(eq(ticketIndex.projectId, project.projectId))
        .pipe(Effect.orDie)

    const listProjects = db
      .select({
        orgSlug: organization.slug,
        organizationId: projectIndex.organizationId,
        projectId: projectIndex.id,
        projectSlug: projectIndex.slug
      })
      .from(projectIndex)
      .innerJoin(organization, eq(organization.id, projectIndex.organizationId))
      .pipe(Effect.orDie)

    const rebuildProject = (project: TicketIndexProject) =>
      Effect.gen(function* () {
        const { documents, skipped } = yield* collectDocuments(project)
        yield* writeProjectIndex(project, documents)
        return { project, indexed: documents.length, skipped }
      })

    const rebuildAllProjects = () =>
      Effect.gen(function* () {
        const projects = yield* listProjects
        const summaries = yield* Effect.forEach(projects, rebuildProject, {
          concurrency: 1
        })
        return { projects: summaries }
      })

    const reconciler = makeTicketIndexReconciler({
      listProjects,
      collectDocuments,
      indexedRefs,
      writeProject: writeProjectIndex
    })

    return {
      projectFor,
      list,
      listIds,
      tagUsageCounts,
      findTicketIdsByTag,
      findTicketIdsByStatus,
      findTicketsByBranch,
      upsertTicket,
      markBranchStale,
      clearBranchStale,
      updateBranchChecks,
      deleteTicket,
      rebuildProject,
      rebuildAllProjects,
      reconcileProject: reconciler.reconcileProject,
      reconcileAllProjects: reconciler.reconcileAllProjects
    }
  })
)

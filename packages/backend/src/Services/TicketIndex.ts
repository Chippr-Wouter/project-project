import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import type {
  ChecksStatus,
  PullRequestState,
  TagName,
  TicketId,
  TicketPriority,
  TicketStatus,
  TicketType,
  TicketCountQuery,
  TicketListQuery
} from "@projectproject/shared"
import type { NotFound } from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"
import type { MalformedTicketDocument, TicketDocument } from "./TicketDocs"

export interface TicketIndexProject {
  readonly orgSlug: string
  readonly organizationId: string
  readonly projectId: string
  readonly projectSlug: string
}

export interface TicketIndexQueryOptions {
  readonly viewerId: string
  readonly ticketIds?: ReadonlyArray<string>
  readonly excludeTicketIds?: ReadonlyArray<string>
  readonly limit: number
}

export interface TicketIndexCountOptions {
  readonly viewerId: string
  readonly ticketIds?: ReadonlyArray<string>
}

export interface TicketIndexCounts {
  readonly total: number
  readonly byStatus: Readonly<Record<string, number>>
}

export interface TicketIndexEntry {
  readonly id: TicketId
  readonly title: string
  readonly status: TicketStatus
  readonly type: TicketType
  readonly priority: TicketPriority
  readonly tags: ReadonlyArray<TagName>
  readonly branch: string | null
  readonly pr: number | null
  readonly prState: PullRequestState | null
  readonly lastTransitionedPr: number | null
  readonly branchDeletedAt: Date | null
  readonly checks: ChecksStatus | null
  readonly checksHeadSha: string | null
  readonly checksUpdatedAt: Date | null
  readonly assignees: ReadonlyArray<string>
  readonly archivedAt: Date | null
  readonly createdBy: string
  readonly createdAt: Date
  readonly updatedAt: Date
}

export interface TicketIndexQueryEntry {
  readonly entry: TicketIndexEntry
  readonly sortValue: string
}

export interface TicketIndexMatch extends TicketIndexProject {
  readonly ticketId: string
  readonly branch: string
}

export interface TicketIndexRebuildProjectSummary {
  readonly project: TicketIndexProject
  readonly indexed: number
  readonly skipped: number
}

export interface TicketIndexRebuildSummary {
  readonly projects: ReadonlyArray<TicketIndexRebuildProjectSummary>
}

export interface TicketIndexDrift {
  readonly missing: ReadonlyArray<string>
  readonly orphaned: ReadonlyArray<string>
  readonly stale: ReadonlyArray<string>
}

export interface TicketIndexReconcileProjectSummary {
  readonly project: TicketIndexProject
  readonly drift: TicketIndexDrift
  readonly rebuilt: boolean
  readonly indexed: number
  readonly skipped: number
}

export interface TicketIndexReconcileSummary {
  readonly projects: ReadonlyArray<TicketIndexReconcileProjectSummary>
  readonly reconciled: number
}

export interface TicketIndexReconcileOptions {
  readonly force?: boolean
}

export interface TicketIndexShape {
  readonly projectFor: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<TicketIndexProject, NotFound>
  readonly list: (
    project: TicketIndexProject,
    ticketIds?: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<TicketIndexEntry>>
  readonly query: (
    project: TicketIndexProject,
    query: TicketListQuery,
    options: TicketIndexQueryOptions
  ) => Effect.Effect<ReadonlyArray<TicketIndexQueryEntry>>
  readonly count: (
    project: TicketIndexProject,
    query: TicketCountQuery,
    options: TicketIndexCountOptions
  ) => Effect.Effect<TicketIndexCounts>
  readonly listIds: (
    project: TicketIndexProject
  ) => Effect.Effect<ReadonlyArray<string>>
  readonly existingIds: (
    project: TicketIndexProject,
    ticketIds: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlySet<string>>
  readonly reserveTicketNumber: (
    project: TicketIndexProject
  ) => Effect.Effect<number>
  readonly tagUsageCounts: (
    project: TicketIndexProject
  ) => Effect.Effect<Readonly<Record<string, number>>>
  readonly findTicketIdsByTag: (
    project: TicketIndexProject,
    tag: string
  ) => Effect.Effect<ReadonlyArray<string>>
  readonly findTicketIdsByStatus: (
    project: TicketIndexProject,
    status: string
  ) => Effect.Effect<ReadonlyArray<string>>
  readonly findTicketsByBranch: (
    projectId: string,
    branch: string
  ) => Effect.Effect<ReadonlyArray<TicketIndexMatch>>
  readonly getBranchDeletedAt: (
    orgSlug: string,
    slug: string,
    ticketId: string
  ) => Effect.Effect<Date | null>
  readonly upsertTicket: (
    project: TicketIndexProject,
    document: TicketDocument
  ) => Effect.Effect<void>
  readonly markBranchStale: (
    projectId: string,
    branch: string,
    deletedAt: Date
  ) => Effect.Effect<ReadonlyArray<string>>
  readonly clearBranchStale: (
    project: TicketIndexProject,
    ticketIds: ReadonlyArray<string>
  ) => Effect.Effect<void>
  readonly updateBranchChecks: (
    projectId: string,
    branch: string,
    checks: ChecksStatus,
    headSha: string,
    updatedAt: Date
  ) => Effect.Effect<ReadonlyArray<string>>
  readonly deleteTicket: (
    project: TicketIndexProject,
    ticketId: string
  ) => Effect.Effect<void>
  readonly rebuildProject: (
    project: TicketIndexProject
  ) => Effect.Effect<
    TicketIndexRebuildProjectSummary,
    MarkdownError | MalformedTicketDocument
  >
  readonly rebuildAllProjects: () => Effect.Effect<
    TicketIndexRebuildSummary,
    MarkdownError | MalformedTicketDocument
  >
  readonly reconcileProject: (
    project: TicketIndexProject,
    options?: TicketIndexReconcileOptions
  ) => Effect.Effect<
    TicketIndexReconcileProjectSummary,
    MarkdownError | MalformedTicketDocument
  >
  readonly reconcileAllProjects: () => Effect.Effect<
    TicketIndexReconcileSummary,
    MarkdownError | MalformedTicketDocument
  >
}

export class TicketIndex extends Context.Service<
  TicketIndex,
  TicketIndexShape
>()("@projectproject/backend/Services/TicketIndex") {}

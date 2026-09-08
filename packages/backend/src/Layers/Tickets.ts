import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  AttachBranchInput,
  BranchExists,
  BranchNotFound,
  BranchProtected,
  Conflict,
  CreateBranchInput,
  CreateTicketInput,
  DEFAULT_TICKET_SORT,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  GitStatesResponse,
  MentionInvalid,
  NotFound,
  OpenPrInput,
  OpenPrResult,
  padNumericIdSort,
  paginateSorted,
  QuickCreateTicketInput,
  RateLimited,
  RepoGone,
  TagName,
  Ticket,
  TICKET_LIST_LIMIT,
  TicketDetail,
  extractAttachmentRefs,
  TicketId,
  tryDecodeCursor,
  UpdateTicketInput,
  Validation,
  type ProjectKey,
  type TicketCountQuery,
  type TicketCounts,
  type TicketFilter,
  type TicketListPage,
  type TicketListQuery,
  type TicketPriority,
  type TicketSort,
  type TicketStatus
} from "@projectproject/shared"
import { matchesTicketQuery } from "@projectproject/shared"
import { Attachments } from "../Services/Attachments"
import { validateBodyMentions } from "../Services/BodyMentions"
import { Comments, type InvalidCommentBody } from "../Services/Comments"
import * as GitHub from "../Services/GitHub"
import { Groups } from "../Services/Groups"
import type { MarkdownError } from "../Services/Markdown"
import { Projects } from "../Services/Projects"
import {
  TicketIndex,
  type TicketIndexEntry,
  type TicketIndexProject
} from "../Services/TicketIndex"
import { Db } from "../Services/Db"
import {
  MalformedTicketDocument,
  TicketDocs,
  type TicketDocument
} from "../Services/TicketDocs"
import { Tickets, type TicketsShape } from "../Services/Tickets"
import {
  planAutomaticBranchLinks,
  planTicketGitStates
} from "../ticketGitStatePlanner"
import * as TicketDocumentLock from "../ticketDocumentLock"
import type { ProjectGithubIntegration } from "../Services/Projects"

const MAX_CREATE_ATTEMPTS = 16
const makeTicketId = Schema.decodeUnknownSync(TicketId)
const makeTagName = Schema.decodeUnknownSync(TagName)

function numericTail(id: string): number {
  const dash = id.lastIndexOf("-")
  if (dash < 0) return Number.NaN
  return Number(id.slice(dash + 1))
}

type TicketReadError = NotFound | MarkdownError | MalformedTicketDocument

function nextIdFrom(key: ProjectKey, ids: ReadonlyArray<TicketId>): TicketId {
  let max = 0
  for (const id of ids) {
    const n = numericTail(id)
    if (Number.isFinite(n) && n > max) max = n
  }
  return makeTicketId(`${key}-${max + 1}`)
}

function pendingGitState(
  document: Omit<TicketDocument, "body">,
  github: ProjectGithubIntegration | null,
  branchDeletedAt: Date | null = null
): Ticket["gitState"] {
  const baseBranch = github?.defaultBaseBranch ?? "main"
  if (!document.branch) return { tag: "no_branch", baseBranch }
  if (document.pr !== null) {
    const url = github
      ? `https://github.com/${github.repoOwner}/${github.repoName}/pull/${document.pr}`
      : ""
    if (document.prState === "merged") {
      return {
        tag: "pr_merged",
        branch: document.branch,
        baseBranch,
        number: document.pr,
        url,
        title: "",
        mergedAt: null
      }
    }
    if (document.prState === "closed") {
      return {
        tag: "pr_closed",
        branch: document.branch,
        baseBranch,
        number: document.pr,
        url,
        title: ""
      }
    }
    return {
      tag: "pr_pending",
      branch: document.branch,
      baseBranch,
      number: document.pr,
      url
    }
  }
  if (branchDeletedAt !== null) {
    return { tag: "stale_branch", name: document.branch }
  }
  return { tag: "branch_pending", name: document.branch, baseBranch }
}

function documentToTicket(
  document: TicketDocument,
  github: ProjectGithubIntegration | null
): Ticket {
  const { body: _body, ...ticket } = document
  return { ...ticket, gitState: pendingGitState(document, github) }
}

function indexEntryToTicket(
  entry: TicketIndexEntry,
  github: ProjectGithubIntegration | null
): Ticket {
  const { branchDeletedAt: _branchDeletedAt, ...ticket } = entry
  return {
    ...ticket,
    gitState: pendingGitState(entry, github, entry.branchDeletedAt)
  }
}

function documentToDetail(
  document: TicketDocument,
  github: ProjectGithubIntegration | null,
  branchDeletedAt: Date | null = null
): TicketDetail {
  return {
    ...document,
    gitState: pendingGitState(document, github, branchDeletedAt)
  }
}

const PRIORITY_ORDINAL: Record<TicketPriority, number> = {
  high: 3,
  med: 2,
  low: 1
}

const sortKeyValue = (t: Ticket, sort: TicketSort): string => {
  switch (sort.key) {
    case "id":
      return padNumericIdSort(t.id) ?? t.id
    case "created":
      return t.createdAt.toISOString()
    case "updated":
      return t.updatedAt.toISOString()
    case "title":
      return t.title.toLowerCase()
    case "priority":
      return String(PRIORITY_ORDINAL[t.priority]).padStart(2, "0")
  }
}

const sortTickets = (
  tickets: ReadonlyArray<Ticket>,
  sort: TicketSort
): ReadonlyArray<Ticket> => {
  const sign = sort.dir === "asc" ? 1 : -1
  return [...tickets].sort((a, b) => {
    const ka = sortKeyValue(a, sort)
    const kb = sortKeyValue(b, sort)
    if (ka < kb) return -1 * sign
    if (ka > kb) return 1 * sign
    return a.id.localeCompare(b.id)
  })
}

export const TicketsLive = Layer.effect(
  Tickets,
  Effect.gen(function* () {
    const ticketDocs = yield* TicketDocs
    const { withTicketDocumentLock, withRepositoryBranchLock } =
      yield* TicketDocumentLock.TicketDocumentLock
    const projects = yield* Projects
    const ticketIndex = yield* TicketIndex
    const github = yield* GitHub.GitHub
    const groups = yield* Groups
    const comments = yield* Comments
    const db = yield* Db
    const attachments = yield* Attachments

    const ensureAccess = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<void, NotFound> =>
      projects.requireMember(orgSlug, userId, slug).pipe(Effect.asVoid)

    const resolveGroupMembers = (
      project: TicketIndexProject,
      orgSlug: string,
      userId: string,
      slug: string,
      groupIds: ReadonlyArray<string | null> | undefined
    ): Effect.Effect<ReadonlySet<string> | null, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        if (groupIds === undefined || groupIds.length === 0) return null
        const wantsUngrouped = groupIds.includes(null)
        const explicitIds = groupIds.filter((id): id is string => id !== null)
        const memberSet = new Set<string>()
        if (explicitIds.length > 0) {
          const details = yield* Effect.forEach(
            explicitIds,
            (id) =>
              groups
                .get(orgSlug, userId, slug, id)
                .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null))),
            { concurrency: 8 }
          )
          for (const g of details) {
            if (g === null) continue
            for (const t of g.tickets) memberSet.add(t)
          }
        }
        if (wantsUngrouped) {
          const allGroups = yield* groups.list(orgSlug, userId, slug)
          const inAnyActiveSprint = new Set<string>()
          for (const g of allGroups) {
            if (g.completedAt !== null) continue
            for (const t of g.tickets) inAnyActiveSprint.add(t)
          }
          const allTicketIds = yield* ticketIndex.listIds(project)
          for (const id of allTicketIds) {
            if (!inAnyActiveSprint.has(id)) memberSet.add(id)
          }
        }
        return memberSet
      })

    const readTicket = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<
      TicketDocument,
      NotFound | MarkdownError | MalformedTicketDocument
    > => ticketDocs.read(orgSlug, slug, id)

    const list = (
      orgSlug: string,
      userId: string,
      slug: string,
      query: TicketListQuery,
      limit?: number
    ): Effect.Effect<TicketListPage, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const project = yield* ticketIndex.projectFor(orgSlug, slug)
        const groupMemberSet = yield* resolveGroupMembers(
          project,
          orgSlug,
          userId,
          slug,
          query.filter?.groupId
        )
        const entries = yield* ticketIndex.list(
          project,
          groupMemberSet === null ? undefined : [...groupMemberSet]
        )
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )

        const filtered = entries
          .map((entry) => indexEntryToTicket(entry, projectGithub))
          .filter((t) => matchesTicketQuery(t, query, userId))
        const sorted = sortTickets(filtered, query.sort)
        const cursor = tryDecodeCursor(query.cursor)
        return paginateSorted(sorted, {
          cursor,
          limit: limit ?? TICKET_LIST_LIMIT,
          sortKey: (t) => sortKeyValue(t, query.sort),
          id: (t) => t.id,
          dir: query.sort.dir
        })
      })

    const listInGroup = (
      orgSlug: string,
      userId: string,
      slug: string,
      groupId: string
    ): Effect.Effect<ReadonlyArray<Ticket>, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const project = yield* ticketIndex.projectFor(orgSlug, slug)
        const group = yield* groups.get(orgSlug, userId, slug, groupId)
        const entries = yield* ticketIndex.list(project, group.tickets)
        const byId = new Map(entries.map((entry) => [entry.id, entry]))
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )
        return group.tickets.flatMap((id) => {
          const entry = byId.get(id)
          if (!entry || entry.archivedAt !== null) return []
          return [indexEntryToTicket(entry, projectGithub)]
        })
      })

    const SEARCH_DEFAULT_LIMIT = 24
    const SEARCH_MAX_LIMIT = 100

    const search = (
      orgSlug: string,
      userId: string,
      slug: string,
      options: {
        readonly q?: string
        readonly excludeGroupId?: string
        readonly limit?: number
      }
    ): Effect.Effect<ReadonlyArray<Ticket>, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const project = yield* ticketIndex.projectFor(orgSlug, slug)
        const excluded = options.excludeGroupId
          ? new Set(
              (yield* groups
                .get(orgSlug, userId, slug, options.excludeGroupId)
                .pipe(
                  Effect.catchTag("NotFound", () =>
                    Effect.succeed({ tickets: [] as ReadonlyArray<string> })
                  )
                )).tickets
            )
          : null
        const entries = yield* ticketIndex.list(project)
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )
        const queryForMatch: Pick<TicketListQuery, "q"> = {
          q: options.q
        }
        const matched = entries
          .map((entry) => indexEntryToTicket(entry, projectGithub))
          .filter((t) => {
            if (excluded !== null && excluded.has(t.id)) return false
            return matchesTicketQuery(t, queryForMatch, userId)
          })
        const limit = Math.min(
          Math.max(1, options.limit ?? SEARCH_DEFAULT_LIMIT),
          SEARCH_MAX_LIMIT
        )
        return sortTickets(matched, DEFAULT_TICKET_SORT).slice(0, limit)
      })

    const tagUsageCounts = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<
      Readonly<Record<string, number>>,
      NotFound | MarkdownError
    > =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const project = yield* ticketIndex.projectFor(orgSlug, slug)
        return yield* ticketIndex.tagUsageCounts(project)
      })

    const count = (
      orgSlug: string,
      userId: string,
      slug: string,
      query: TicketCountQuery
    ): Effect.Effect<TicketCounts, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const project = yield* ticketIndex.projectFor(orgSlug, slug)
        const groupMemberSet = yield* resolveGroupMembers(
          project,
          orgSlug,
          userId,
          slug,
          query.filter?.groupId
        )
        const entries = yield* ticketIndex.list(
          project,
          groupMemberSet === null ? undefined : [...groupMemberSet]
        )
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )

        const filterWithoutStatus: TicketFilter | undefined = query.filter
          ? { ...query.filter, status: undefined }
          : undefined
        const queryForCount: Pick<TicketListQuery, "filter" | "q"> = {
          filter: filterWithoutStatus,
          q: query.q
        }

        const matching = entries
          .map((entry) => indexEntryToTicket(entry, projectGithub))
          .filter((t) => matchesTicketQuery(t, queryForCount, userId))

        const byStatus: Record<string, number> = {}
        for (const t of matching)
          byStatus[t.status] = (byStatus[t.status] ?? 0) + 1

        return {
          total: matching.length,
          byStatus: byStatus as TicketCounts["byStatus"]
        }
      })

    const get = (
      orgSlug: string,
      ownerId: string,
      slug: string,
      id: string
    ): Effect.Effect<TicketDetail, TicketReadError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, ownerId, slug)
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          ownerId,
          slug
        )
        const ticket = yield* readTicket(orgSlug, slug, id)
        const indexProject = yield* ticketIndex
          .projectFor(orgSlug, slug)
          .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)))
        const branchDeletedAt = indexProject
          ? ((yield* ticketIndex.list(indexProject, [id]))[0]
              ?.branchDeletedAt ?? null)
          : null
        return yield* withMissingAttachments(
          orgSlug,
          documentToDetail(ticket, projectGithub, branchDeletedAt)
        )
      })

    const withMissingAttachments = (orgSlug: string, detail: TicketDetail) =>
      attachments
        .missingIds(
          orgSlug,
          extractAttachmentRefs(detail.body)
            .filter((ref) => ref.orgSlug === orgSlug)
            .map((ref) => ref.id)
        )
        .pipe(
          Effect.map((missingAttachments) => ({
            ...detail,
            missingAttachments
          }))
        )

    const validateTagsExist = (
      slug: string,
      requested: ReadonlyArray<string>
    ): Effect.Effect<void, NotFound | Validation> =>
      Effect.gen(function* () {
        if (requested.length === 0) return
        const projectRow = yield* db.query.projectIndex
          .findFirst({
            columns: { id: true },
            where: {
              RAW: (table, _operators) => _operators.eq(table.slug, slug)!
            }
          })
          .pipe(Effect.orDie)
        if (!projectRow) return yield* new NotFound()
        const rows = yield* db.query.projectTag
          .findMany({
            columns: { name: true },
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectId, projectRow.id)!
            }
          })
          .pipe(Effect.orDie)
        const known = new Set<string>(rows.map((r) => r.name))
        const missing = requested.filter((name) => !known.has(name))
        if (missing.length > 0) {
          return yield* new Validation({
            reason: `unknown_tags:${missing.join(",")}`
          })
        }
      })

    const validateStatusExists = (
      slug: string,
      requested: TicketStatus
    ): Effect.Effect<void, NotFound | Validation> =>
      Effect.gen(function* () {
        const projectRow = yield* db.query.projectIndex
          .findFirst({
            columns: { id: true },
            where: {
              RAW: (table, _operators) => _operators.eq(table.slug, slug)!
            }
          })
          .pipe(Effect.orDie)
        if (!projectRow) return yield* new NotFound()
        const rows = yield* db.query.projectStatus
          .findMany({
            columns: { slug: true },
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectId, projectRow.id)!
            }
          })
          .pipe(Effect.orDie)
        const known = new Set<string>(rows.map((r) => r.slug))
        if (!known.has(requested)) {
          return yield* new Validation({
            reason: `unknown_status:${requested}`
          })
        }
      })

    const validateBody = (
      orgSlug: string,
      ownerId: string,
      slug: string,
      body: string
    ): Effect.Effect<void, NotFound | MentionInvalid | MarkdownError> =>
      Effect.gen(function* () {
        if (!body.includes("](mention:")) return
        const project = yield* projects.get(orgSlug, ownerId, slug)
        const memberIds = new Set<string>(project.members.map((m) => m.id))
        const ids = yield* ticketDocs.listIds(orgSlug, slug)
        const ticketIds = new Set<string>(ids)
        yield* validateBodyMentions(body, memberIds, ticketIds)
      })

    const validateAssigneesAreMembers = (
      orgSlug: string,
      slug: string,
      assignees: ReadonlyArray<string>
    ): Effect.Effect<void, Validation> =>
      Effect.gen(function* () {
        const checks = yield* Effect.forEach(
          assignees,
          (assigneeId) =>
            projects.requireMember(orgSlug, assigneeId, slug).pipe(
              Effect.as({ id: assigneeId, ok: true as const }),
              Effect.catchTag("NotFound", () =>
                Effect.succeed({ id: assigneeId, ok: false as const })
              )
            ),
          { concurrency: 8 }
        )
        const invalid = checks.filter((c) => !c.ok).map((c) => c.id)
        if (invalid.length > 0) {
          return yield* new Validation({
            reason: `non_member_assignees:${invalid.join(",")}`
          })
        }
      })

    const writeWithIdAllocation = (
      orgSlug: string,
      slug: string,
      projectKey: ProjectKey,
      buildDocument: (id: TicketId) => TicketDocument
    ): Effect.Effect<TicketDocument, MarkdownError> =>
      Effect.gen(function* () {
        const ids = yield* ticketDocs.listIds(orgSlug, slug)
        let candidate = nextIdFrom(projectKey, ids)
        for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
          const document = buildDocument(candidate)
          const result = yield* ticketDocs.create(orgSlug, slug, document).pipe(
            Effect.map(() => "ok" as const),
            Effect.catchTag("TicketIdTaken", () =>
              Effect.succeed("retry" as const)
            )
          )
          if (result === "ok") return document
          const freshIds = yield* ticketDocs.listIds(orgSlug, slug)
          candidate = nextIdFrom(projectKey, freshIds)
        }
        return yield* Effect.die(
          new Error(`could not allocate ticket id for "${slug}"`)
        )
      })

    const quickCreate = (
      orgSlug: string,
      ownerId: string,
      slug: string,
      input: QuickCreateTicketInput
    ): Effect.Effect<Ticket, NotFound | Validation | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, ownerId, slug)
        if (input.status !== undefined) {
          yield* validateStatusExists(slug, input.status)
        }
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const projectKey = yield* projects.getKey(orgSlug, ownerId, slug)
        const now = yield* DateTime.nowAsDate
        const document = yield* writeWithIdAllocation(
          orgSlug,
          slug,
          projectKey,
          (id) => ({
            id,
            title: input.title,
            status: (input.status ?? "todo") as TicketStatus,
            type: input.type ?? "other",
            priority: "med",
            tags: [],
            branch: null,
            pr: null,
            prState: null,
            lastTransitionedPr: null,
            assignees: [],
            archivedAt: null,
            createdBy: ownerId,
            createdAt: now,
            updatedAt: now,
            body: ""
          })
        )
        yield* attachments.reconcileTicket(
          orgSlug,
          slug,
          document.id,
          document.body
        )
        yield* ticketIndex.upsertTicket(indexProject, document)
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          ownerId,
          slug
        )
        return documentToTicket(document, projectGithub)
      })

    const create = (
      orgSlug: string,
      ownerId: string,
      slug: string,
      input: CreateTicketInput
    ): Effect.Effect<
      TicketDetail,
      NotFound | Validation | MentionInvalid | MarkdownError
    > =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, ownerId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const projectKey = yield* projects.getKey(orgSlug, ownerId, slug)
        if (input.tags !== undefined) {
          yield* validateTagsExist(slug, input.tags)
        }
        if (input.assignees !== undefined && input.assignees.length > 0) {
          yield* validateAssigneesAreMembers(orgSlug, slug, input.assignees)
        }
        if (input.body !== undefined) {
          yield* validateBody(orgSlug, ownerId, slug, input.body)
        }
        const now = yield* DateTime.nowAsDate
        const document = yield* writeWithIdAllocation(
          orgSlug,
          slug,
          projectKey,
          (id) => ({
            id,
            title: input.title,
            status: (input.status ?? "todo") as TicketStatus,
            type: input.type ?? "other",
            priority: input.priority ?? "med",
            tags: input.tags !== undefined ? [...input.tags] : [],
            branch: null,
            pr: null,
            prState: null,
            lastTransitionedPr: null,
            assignees:
              input.assignees !== undefined ? [...input.assignees] : [],
            archivedAt: null,
            createdBy: ownerId,
            createdAt: now,
            updatedAt: now,
            body: input.body ?? ""
          })
        )
        yield* attachments.reconcileTicket(
          orgSlug,
          slug,
          document.id,
          document.body
        )
        yield* ticketIndex.upsertTicket(indexProject, document)
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          ownerId,
          slug
        )
        return documentToDetail(document, projectGithub)
      })

    const update = (
      orgSlug: string,
      ownerId: string,
      slug: string,
      id: string,
      input: UpdateTicketInput
    ): Effect.Effect<
      TicketDetail,
      TicketReadError | Validation | MentionInvalid
    > =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, ownerId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const existing = yield* readTicket(orgSlug, slug, id)

          if (input.tags !== undefined) {
            yield* validateTagsExist(slug, input.tags)
          }

          if (input.assignees !== undefined) {
            const existingSet = new Set(existing.assignees)
            const newcomers = input.assignees.filter(
              (assigneeId) => !existingSet.has(assigneeId)
            )
            if (newcomers.length > 0) {
              yield* validateAssigneesAreMembers(orgSlug, slug, newcomers)
            }
          }

          if (input.body !== undefined) {
            yield* validateBody(orgSlug, ownerId, slug, input.body)
          }

          const next: TicketDocument = {
            id: existing.id,
            title: input.title ?? existing.title,
            status: input.status ?? existing.status,
            type: input.type ?? existing.type,
            priority: input.priority ?? existing.priority,
            tags: input.tags !== undefined ? [...input.tags] : existing.tags,
            branch: existing.branch,
            branchAutoLinkDisabled: existing.branchAutoLinkDisabled,
            pr: existing.pr,
            prState: existing.prState,
            lastTransitionedPr: existing.lastTransitionedPr,
            assignees:
              input.assignees !== undefined
                ? input.assignees
                : existing.assignees,
            archivedAt: existing.archivedAt,
            createdBy: existing.createdBy,
            createdAt: existing.createdAt,
            updatedAt: yield* DateTime.nowAsDate,
            body: input.body ?? existing.body
          }

          yield* ticketDocs.write(orgSlug, slug, id, next)
          yield* attachments.reconcileTicket(orgSlug, slug, id, next.body)
          yield* ticketIndex.upsertTicket(indexProject, next)

          const projectGithub = yield* projects.getGithubIntegration(
            orgSlug,
            ownerId,
            slug
          )
          return yield* withMissingAttachments(
            orgSlug,
            documentToDetail(next, projectGithub)
          )
        })
      )

    const remove = (
      orgSlug: string,
      ownerId: string,
      slug: string,
      id: string
    ): Effect.Effect<void, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, ownerId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        yield* groups.removeTicketFromAllGroups(orgSlug, slug, id)
        yield* withTicketDocumentLock(
          orgSlug,
          slug,
          id,
          Effect.gen(function* () {
            yield* attachments.reconcileTicket(orgSlug, slug, id, "")
            yield* ticketDocs.remove(orgSlug, slug, id)
            yield* ticketIndex.deleteTicket(indexProject, id)
          })
        )
      })

    const archive = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string,
      reason?: string
    ): Effect.Effect<
      TicketDetail,
      TicketReadError | MentionInvalid | InvalidCommentBody
    > =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, userId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const existing = yield* readTicket(orgSlug, slug, id)
          const now = yield* DateTime.nowAsDate
          const next: TicketDocument = {
            ...existing,
            archivedAt: existing.archivedAt ?? now,
            updatedAt: now
          }
          const trimmed = reason?.trim()
          if (trimmed !== undefined && trimmed.length > 0) {
            yield* comments
              .create(orgSlug, userId, slug, existing.id, { body: trimmed })
              .pipe(Effect.asVoid)
          }
          yield* ticketDocs.write(orgSlug, slug, id, next)
          yield* ticketIndex.upsertTicket(indexProject, next)
          const projectGithub = yield* projects.getGithubIntegration(
            orgSlug,
            userId,
            slug
          )
          return documentToDetail(next, projectGithub)
        })
      )

    const unarchive = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string
    ): Effect.Effect<TicketDetail, TicketReadError> =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, userId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const existing = yield* readTicket(orgSlug, slug, id)
          const next: TicketDocument = {
            ...existing,
            archivedAt: null,
            updatedAt: yield* DateTime.nowAsDate
          }
          yield* ticketDocs.write(orgSlug, slug, id, next)
          yield* ticketIndex.upsertTicket(indexProject, next)
          const projectGithub = yield* projects.getGithubIntegration(
            orgSlug,
            userId,
            slug
          )
          return documentToDetail(next, projectGithub)
        })
      )

    const replaceTag = (
      orgSlug: string,
      slug: string,
      id: string,
      oldName: string,
      newName: string | null
    ): Effect.Effect<boolean, TicketReadError> =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const existing = yield* readTicket(orgSlug, slug, id)
          if (!existing.tags.some((tag) => tag === oldName)) return false
          const nextTags =
            newName === null
              ? existing.tags.filter((t) => t !== oldName)
              : existing.tags.map((t) =>
                  t === oldName ? makeTagName(newName) : t
                )
          const next: TicketDocument = {
            ...existing,
            tags: nextTags,
            updatedAt: yield* DateTime.nowAsDate
          }
          yield* ticketDocs.write(orgSlug, slug, id, next)
          yield* ticketIndex.upsertTicket(indexProject, next)
          return true
        })
      )

    const replaceStatus = (
      orgSlug: string,
      slug: string,
      id: string,
      newStatus: string
    ): Effect.Effect<boolean, TicketReadError> =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const existing = yield* readTicket(orgSlug, slug, id)
          if (existing.status === newStatus) return false
          const next: TicketDocument = {
            ...existing,
            status: newStatus as typeof existing.status,
            updatedAt: yield* DateTime.nowAsDate
          }
          yield* ticketDocs.write(orgSlug, slug, id, next)
          yield* ticketIndex.upsertTicket(indexProject, next)
          return true
        })
      )

    const writeGitFields = (
      indexProject: TicketIndexProject,
      existing: TicketDocument,
      patch: {
        branch?: string | null
        branchAutoLinkDisabled?: boolean
        pr?: number | null
        prState?: TicketDocument["prState"]
        lastTransitionedPr?: number | null
        status?: TicketDocument["status"]
      }
    ): Effect.Effect<TicketDocument, MarkdownError> =>
      Effect.gen(function* () {
        const next: TicketDocument = {
          ...existing,
          branch: patch.branch !== undefined ? patch.branch : existing.branch,
          branchAutoLinkDisabled:
            patch.branchAutoLinkDisabled ?? existing.branchAutoLinkDisabled,
          pr: patch.pr !== undefined ? patch.pr : existing.pr,
          prState:
            patch.prState !== undefined ? patch.prState : existing.prState,
          lastTransitionedPr:
            patch.lastTransitionedPr !== undefined
              ? patch.lastTransitionedPr
              : existing.lastTransitionedPr,
          status: patch.status ?? existing.status,
          updatedAt: yield* DateTime.nowAsDate
        }
        yield* ticketDocs.write(
          indexProject.orgSlug,
          indexProject.projectSlug,
          existing.id,
          next
        )
        yield* ticketIndex.upsertTicket(indexProject, next)
        return next
      })

    const createBranch = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string,
      input: CreateBranchInput
    ): Effect.Effect<
      TicketDetail,
      | NotFound
      | Conflict
      | BranchExists
      | BranchProtected
      | GitHubTokenExpired
      | GitHubScopeInsufficient
      | RepoGone
      | RateLimited
      | GitHubError
      | MarkdownError
      | MalformedTicketDocument
    > =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, userId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const projectGithub = yield* projects.getGithubIntegration(
            orgSlug,
            userId,
            slug
          )
          if (!projectGithub) {
            return yield* new Conflict({ reason: "no_github_connection" })
          }
          const ticket = yield* readTicket(orgSlug, slug, id)
          const baseBranch = input.baseBranch ?? projectGithub.defaultBaseBranch

          yield* github.createBranchAsUser(
            projectGithub.repoOwner,
            projectGithub.repoName,
            input.name,
            baseBranch,
            userId
          )

          const next = yield* withRepositoryBranchLock(
            projectGithub.repoId,
            writeGitFields(indexProject, ticket, {
              branch: input.name,
              branchAutoLinkDisabled: false,
              pr: null,
              prState: null,
              lastTransitionedPr: null
            })
          )
          return documentToDetail(next, projectGithub)
        })
      )

    const attachBranch = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string,
      input: AttachBranchInput
    ): Effect.Effect<
      TicketDetail,
      | NotFound
      | Conflict
      | BranchNotFound
      | GitHubTokenExpired
      | GitHubScopeInsufficient
      | RepoGone
      | RateLimited
      | GitHubError
      | MarkdownError
      | MalformedTicketDocument
    > =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, userId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const projectGithub = yield* projects.getGithubIntegration(
            orgSlug,
            userId,
            slug
          )
          if (!projectGithub) {
            return yield* new Conflict({ reason: "no_github_connection" })
          }
          const ticket = yield* readTicket(orgSlug, slug, id)

          const exists = yield* github.branchExistsInstallation(
            projectGithub.installationId,
            projectGithub.repoOwner,
            projectGithub.repoName,
            input.name
          )
          if (!exists) {
            return yield* new BranchNotFound({ name: input.name })
          }

          const next = yield* withRepositoryBranchLock(
            projectGithub.repoId,
            writeGitFields(indexProject, ticket, {
              branch: input.name,
              branchAutoLinkDisabled: false,
              pr: null,
              prState: null,
              lastTransitionedPr: null
            })
          )
          return documentToDetail(next, projectGithub)
        })
      )

    const openPr = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string,
      input: OpenPrInput
    ): Effect.Effect<
      OpenPrResult,
      | NotFound
      | Conflict
      | BranchProtected
      | GitHubTokenExpired
      | GitHubScopeInsufficient
      | RepoGone
      | RateLimited
      | GitHubError
      | MarkdownError
      | MalformedTicketDocument
    > =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, userId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const projectGithub = yield* projects.getGithubIntegration(
            orgSlug,
            userId,
            slug
          )
          if (!projectGithub) {
            return yield* new Conflict({ reason: "no_github_connection" })
          }
          const ticket = yield* readTicket(orgSlug, slug, id)
          if (!ticket.branch) {
            return yield* new Conflict({ reason: "no_branch_on_ticket" })
          }

          const base = projectGithub.defaultBaseBranch
          const result = yield* github.openPullRequestAsUser(
            projectGithub.repoOwner,
            projectGithub.repoName,
            {
              head: ticket.branch,
              base,
              title: input.title ?? ticket.title,
              body:
                input.body ??
                `Resolves ticket ${ticket.id}: ${ticket.title}\n\n` +
                  `_Tracked in ProjectProject._`,
              draft: input.draft ?? false
            },
            userId
          )

          yield* writeGitFields(indexProject, ticket, {
            pr: result.number,
            prState: "open",
            lastTransitionedPr: null
          })
          return result
        })
      )

    const clearBranch = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string
    ): Effect.Effect<TicketDetail, TicketReadError> =>
      withTicketDocumentLock(
        orgSlug,
        slug,
        id,
        Effect.gen(function* () {
          yield* ensureAccess(orgSlug, userId, slug)
          const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
          const ticket = yield* readTicket(orgSlug, slug, id)
          const next = yield* writeGitFields(indexProject, ticket, {
            branch: null,
            branchAutoLinkDisabled: true,
            pr: null,
            prState: null,
            lastTransitionedPr: null
          })
          return documentToDetail(next, null)
        })
      )

    const fetchGitSnapshot = Effect.fn("Tickets.fetchGitSnapshot")(function* (
      projectGithub: ProjectGithubIntegration,
      tickets: ReadonlyArray<TicketIndexEntry>
    ) {
      const branches = [
        ...new Set(
          tickets.flatMap((ticket) =>
            ticket.branch && ticket.branch.length > 0 ? [ticket.branch] : []
          )
        )
      ]
      const unlinkedTicket = tickets.find(
        (ticket) => ticket.branch === null && ticket.archivedAt === null
      )
      const branchQuery = unlinkedTicket
        ? `${unlinkedTicket.id.slice(0, unlinkedTicket.id.lastIndexOf("-"))}-`
        : undefined
      return yield* github
        .fetchInstallationProjectStates(
          projectGithub.installationId,
          projectGithub.repoOwner,
          projectGithub.repoName,
          branches,
          branchQuery
        )
        .pipe(
          Effect.map((raw) => ({ ok: true as const, raw })),
          Effect.catchTags({
            RepoGone: () =>
              Effect.succeed({
                ok: false as const,
                tokenStatus: "ok" as const,
                repoStatus: "gone" as const
              }),
            RateLimited: (error) =>
              Effect.succeed({
                ok: false as const,
                tokenStatus: "ok" as const,
                repoStatus: "ok" as const,
                refreshStatus: "rate_limited" as const,
                retryAt: error.resetAt
              }),
            GitHubError: () =>
              Effect.succeed({
                ok: false as const,
                tokenStatus: "ok" as const,
                repoStatus: "ok" as const,
                refreshStatus: "stale" as const
              })
          })
        )
    })

    const reconcileGitStates = Effect.fn("Tickets.reconcileGitStates")(
      function* (
        indexProject: TicketIndexProject,
        projectGithub: ProjectGithubIntegration,
        tickets: ReadonlyArray<TicketIndexEntry>,
        raw: GitHub.RawProjectStates
      ): Effect.fn.Return<GitStatesResponse, MarkdownError> {
        const { orgSlug, projectSlug: slug } = indexProject
        const automaticLinks = planAutomaticBranchLinks(
          tickets,
          raw.existingBranches,
          raw.defaultBranch
        )
        const plannedTickets = tickets.map((ticket) => {
          const branch = automaticLinks.get(ticket.id)
          return branch
            ? {
                ...ticket,
                branch,
                pr: null,
                prState: null,
                lastTransitionedPr: null
              }
            : ticket
        })
        const plan = planTicketGitStates(
          plannedTickets,
          raw,
          yield* DateTime.nowAsDate
        )
        const indexedTickets = new Map(
          tickets.map((ticket) => [ticket.id, ticket])
        )
        const states = { ...plan.states }
        const staleTicketIds = new Set<string>()

        const resurrected = tickets.flatMap((ticket) =>
          ticket.branchDeletedAt !== null &&
          ticket.branch !== null &&
          raw.existingBranches.has(ticket.branch)
            ? [ticket.id]
            : []
        )
        const resurrectedIds = new Set(resurrected)
        const changedTicketIds = new Set<TicketId>()
        const writesById = new Map<
          TicketId,
          Parameters<typeof writeGitFields>[2]
        >(plan.writes.map((write) => [write.ticketId, write.patch]))
        for (const [ticketId, branch] of automaticLinks) {
          writesById.set(ticketId, {
            branch,
            pr: null,
            prState: null,
            lastTransitionedPr: null,
            ...writesById.get(ticketId)
          })
        }
        const ticketIds = new Set([...writesById.keys(), ...resurrectedIds])

        for (const ticketId of ticketIds) {
          const automaticBranch = automaticLinks.get(ticketId)
          const reconcile = Effect.gen(function* () {
            const ticket = yield* readTicket(orgSlug, slug, ticketId).pipe(
              Effect.catchTags({
                MalformedTicketDocument: (error) =>
                  Effect.logWarning(
                    "Skipping unreadable ticket for git state",
                    {
                      orgSlug,
                      slug,
                      ticketId,
                      error
                    }
                  ).pipe(Effect.as(null)),
                NotFound: () =>
                  Effect.logDebug("Skipping vanished indexed ticket", {
                    orgSlug,
                    slug,
                    ticketId
                  }).pipe(Effect.as(null))
              })
            )
            if (ticket === null) {
              staleTicketIds.add(ticketId)
              delete states[ticketId]
              return
            }
            const indexedTicket = indexedTickets.get(ticketId)
            if (
              indexedTicket?.branch !== ticket.branch ||
              indexedTicket.updatedAt.getTime() !==
                ticket.updatedAt.getTime() ||
              indexedTicket.pr !== ticket.pr ||
              indexedTicket.prState !== ticket.prState ||
              (raw.fetchedAt !== undefined &&
                ticket.updatedAt.getTime() > raw.fetchedAt.getTime())
            ) {
              staleTicketIds.add(ticketId)
              states[ticketId] = pendingGitState(ticket, projectGithub)
              return
            }
            if (automaticBranch) {
              const attached = yield* ticketIndex.isRepositoryBranchAttached(
                projectGithub.repoId,
                automaticBranch
              )
              if (
                ticket.branchAutoLinkDisabled ||
                ticket.archivedAt !== null ||
                attached
              ) {
                staleTicketIds.add(ticketId)
                states[ticketId] = pendingGitState(ticket, projectGithub)
                return
              }
            }
            if (resurrectedIds.has(ticketId)) {
              yield* ticketIndex.clearBranchStale(indexProject, [ticketId])
              changedTicketIds.add(ticketId)
            }
            const write = writesById.get(ticketId)
            if (!write) return
            yield* writeGitFields(indexProject, ticket, write)
            changedTicketIds.add(ticketId)
          })
          yield* withTicketDocumentLock(
            orgSlug,
            slug,
            ticketId,
            automaticBranch
              ? withRepositoryBranchLock(projectGithub.repoId, reconcile)
              : reconcile
          )
        }

        return {
          states,
          refreshStatus: "fresh",
          changedTicketIds: [...changedTicketIds],
          transitioned: plan.transitioned.filter(
            (transition) => !staleTicketIds.has(transition.ticketId)
          ),
          tokenStatus: "ok",
          repoStatus: "ok"
        }
      }
    )

    const listGitStates = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<GitStatesResponse, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )

        if (!projectGithub) {
          return {
            states: {},
            transitioned: [],
            tokenStatus: "ok",
            repoStatus: "not_connected"
          }
        }

        const tickets = yield* ticketIndex.list(indexProject)
        const result = yield* fetchGitSnapshot(projectGithub, tickets)

        if (!result.ok) {
          return {
            states:
              result.repoStatus === "gone"
                ? {}
                : Object.fromEntries(
                    tickets.map((ticket) => [
                      ticket.id,
                      pendingGitState(ticket, projectGithub)
                    ])
                  ),
            transitioned: [],
            changedTicketIds: [],
            tokenStatus: result.tokenStatus,
            repoStatus: result.repoStatus,
            ...("refreshStatus" in result
              ? { refreshStatus: result.refreshStatus }
              : {}),
            ...("retryAt" in result ? { retryAt: result.retryAt } : {})
          }
        }

        if (result.raw.refreshStatus) {
          const snapshot = planTicketGitStates(
            tickets,
            result.raw,
            yield* DateTime.nowAsDate
          )
          return {
            states: Object.fromEntries(
              tickets.map((ticket) => [
                ticket.id,
                ticket.branch &&
                (result.raw.existingBranches.has(ticket.branch) ||
                  result.raw.prByBranch.has(ticket.branch))
                  ? snapshot.states[ticket.id]
                  : pendingGitState(ticket, projectGithub)
              ])
            ),
            transitioned: [],
            changedTicketIds: [],
            tokenStatus: "ok",
            repoStatus: "ok",
            refreshStatus: result.raw.refreshStatus,
            retryAt: result.raw.retryAt
          }
        }

        return yield* reconcileGitStates(
          indexProject,
          projectGithub,
          tickets,
          result.raw
        )
      })

    const getGitState = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: string | undefined
    ): Effect.Effect<GitStatesResponse, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        const all = yield* listGitStates(orgSlug, userId, slug)
        if (ticketId === undefined) return all
        const single = all.states[ticketId]
        return {
          ...all,
          states: single ? { [ticketId]: single } : {},
          changedTicketIds: all.changedTicketIds?.filter(
            (id) => id === ticketId
          ),
          transitioned: all.transitioned.filter((t) => t.ticketId === ticketId)
        }
      })

    return {
      list,
      count,
      search,
      listInGroup,
      tagUsageCounts,
      get,
      quickCreate,
      create,
      update,
      remove,
      archive,
      unarchive,
      replaceTag,
      replaceStatus,
      createBranch,
      attachBranch,
      openPr,
      clearBranch,
      listGitStates,
      getGitState
    } satisfies TicketsShape
  })
)

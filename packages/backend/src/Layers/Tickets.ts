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
import { GitHub } from "../Services/GitHub"
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
import { planTicketGitStates } from "../ticketGitStatePlanner"
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
  document: Omit<TicketDocument, "body" | "commentsRegion">,
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
  github: ProjectGithubIntegration | null,
  branchDeletedAt: Date | null = null
): Ticket {
  const { body: _body, commentsRegion: _commentsRegion, ...ticket } = document
  return {
    ...ticket,
    gitState: pendingGitState(document, github, branchDeletedAt)
  }
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
    ...documentToTicket(document, github, branchDeletedAt),
    body: document.body
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
    const projects = yield* Projects
    const ticketIndex = yield* TicketIndex
    const github = yield* GitHub
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
            body: "",
            commentsRegion: ""
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
            body: input.body ?? "",
            commentsRegion: ""
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
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, ownerId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)

        if (input.tags !== undefined) {
          yield* validateTagsExist(slug, input.tags)
        }

        if (input.body !== undefined) {
          yield* validateBody(orgSlug, ownerId, slug, input.body)
        }

        const next = yield* ticketDocs.update(
          orgSlug,
          slug,
          id,
          (existing) =>
            Effect.gen(function* () {
              if (input.assignees !== undefined) {
                const existingSet = new Set(existing.assignees)
                const newcomers = input.assignees.filter(
                  (assigneeId) => !existingSet.has(assigneeId)
                )
                if (newcomers.length > 0) {
                  yield* validateAssigneesAreMembers(orgSlug, slug, newcomers)
                }
              }
              return {
                ...existing,
                title: input.title ?? existing.title,
                status: input.status ?? existing.status,
                type: input.type ?? existing.type,
                priority: input.priority ?? existing.priority,
                tags:
                  input.tags !== undefined ? [...input.tags] : existing.tags,
                assignees:
                  input.assignees !== undefined
                    ? input.assignees
                    : existing.assignees,
                updatedAt: yield* DateTime.nowAsDate,
                body: input.body ?? existing.body
              }
            }),
          (next) =>
            attachments
              .reconcileTicket(orgSlug, slug, id, next.body)
              .pipe(
                Effect.andThen(ticketIndex.upsertTicket(indexProject, next))
              )
        )

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
        yield* attachments.reconcileTicket(orgSlug, slug, id, "")
        yield* ticketDocs.remove(orgSlug, slug, id)
        yield* ticketIndex.deleteTicket(indexProject, id)
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
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const trimmed = reason?.trim()
        if (trimmed !== undefined && trimmed.length > 0) {
          yield* comments
            .create(orgSlug, userId, slug, makeTicketId(id), { body: trimmed })
            .pipe(Effect.asVoid)
        }
        const next = yield* ticketDocs.update(
          orgSlug,
          slug,
          id,
          (existing) =>
            DateTime.nowAsDate.pipe(
              Effect.map((now) => ({
                ...existing,
                archivedAt: existing.archivedAt ?? now,
                updatedAt: now
              }))
            ),
          (next) => ticketIndex.upsertTicket(indexProject, next)
        )
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )
        return documentToDetail(next, projectGithub)
      })

    const unarchive = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string
    ): Effect.Effect<TicketDetail, TicketReadError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const next = yield* ticketDocs.update(
          orgSlug,
          slug,
          id,
          (existing) =>
            DateTime.nowAsDate.pipe(
              Effect.map((updatedAt) => ({
                ...existing,
                archivedAt: null,
                updatedAt
              }))
            ),
          (next) => ticketIndex.upsertTicket(indexProject, next)
        )
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )
        return documentToDetail(next, projectGithub)
      })

    const replaceTag = (
      orgSlug: string,
      slug: string,
      id: string,
      oldName: string,
      newName: string | null
    ): Effect.Effect<boolean, TicketReadError> =>
      Effect.gen(function* () {
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        let replaced = false
        yield* ticketDocs.update(
          orgSlug,
          slug,
          id,
          (existing) => {
            if (!existing.tags.some((tag) => tag === oldName)) {
              return Effect.succeed(existing)
            }
            replaced = true
            const tags =
              newName === null
                ? existing.tags.filter((tag) => tag !== oldName)
                : existing.tags.map((tag) =>
                    tag === oldName ? makeTagName(newName) : tag
                  )
            return DateTime.nowAsDate.pipe(
              Effect.map((updatedAt) => ({ ...existing, tags, updatedAt }))
            )
          },
          (next) =>
            replaced
              ? ticketIndex.upsertTicket(indexProject, next)
              : Effect.void
        )
        if (!replaced) return false
        return true
      })

    const replaceStatus = (
      orgSlug: string,
      slug: string,
      id: string,
      newStatus: string
    ): Effect.Effect<boolean, TicketReadError> =>
      Effect.gen(function* () {
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        let replaced = false
        yield* ticketDocs.update(
          orgSlug,
          slug,
          id,
          (existing) => {
            if (existing.status === newStatus) {
              return Effect.succeed(existing)
            }
            replaced = true
            return DateTime.nowAsDate.pipe(
              Effect.map((updatedAt) => ({
                ...existing,
                status: newStatus as typeof existing.status,
                updatedAt
              }))
            )
          },
          (next) =>
            replaced
              ? ticketIndex.upsertTicket(indexProject, next)
              : Effect.void
        )
        if (!replaced) return false
        return true
      })

    const writeGitFields = (
      orgSlug: string,
      slug: string,
      id: string,
      indexProject: TicketIndexProject,
      _projectGithub: ProjectGithubIntegration | null | undefined,
      patch: {
        branch?: string | null
        pr?: number | null
        prState?: TicketDocument["prState"]
        lastTransitionedPr?: number | null
        status?: TicketDocument["status"]
      }
    ): Effect.Effect<TicketDocument, TicketReadError> =>
      Effect.gen(function* () {
        const next = yield* ticketDocs.update(
          orgSlug,
          slug,
          id,
          (existing) =>
            DateTime.nowAsDate.pipe(
              Effect.map((updatedAt) => ({
                ...existing,
                branch:
                  patch.branch !== undefined ? patch.branch : existing.branch,
                pr: patch.pr !== undefined ? patch.pr : existing.pr,
                prState:
                  patch.prState !== undefined
                    ? patch.prState
                    : existing.prState,
                lastTransitionedPr:
                  patch.lastTransitionedPr !== undefined
                    ? patch.lastTransitionedPr
                    : existing.lastTransitionedPr,
                status: patch.status ?? existing.status,
                updatedAt
              }))
            ),
          (next) => ticketIndex.upsertTicket(indexProject, next)
        )
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
        yield* readTicket(orgSlug, slug, id)
        const baseBranch = input.baseBranch ?? projectGithub.defaultBaseBranch

        yield* github.createBranchAsUser(
          projectGithub.repoOwner,
          projectGithub.repoName,
          input.name,
          baseBranch,
          userId
        )

        const next = yield* writeGitFields(
          orgSlug,
          slug,
          id,
          indexProject,
          projectGithub,
          {
            branch: input.name,
            pr: null,
            prState: null,
            lastTransitionedPr: null
          }
        )
        return documentToDetail(next, projectGithub)
      })

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
        yield* readTicket(orgSlug, slug, id)

        const exists = yield* github.branchExistsInstallation(
          projectGithub.installationId,
          projectGithub.repoOwner,
          projectGithub.repoName,
          input.name
        )
        if (!exists) {
          return yield* new BranchNotFound({ name: input.name })
        }

        const next = yield* writeGitFields(
          orgSlug,
          slug,
          id,
          indexProject,
          projectGithub,
          {
            branch: input.name,
            pr: null,
            prState: null,
            lastTransitionedPr: null
          }
        )
        return documentToDetail(next, projectGithub)
      })

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

        yield* writeGitFields(orgSlug, slug, id, indexProject, projectGithub, {
          pr: result.number,
          prState: "open",
          lastTransitionedPr: null
        })
        return result
      })

    const clearBranch = (
      orgSlug: string,
      userId: string,
      slug: string,
      id: string
    ): Effect.Effect<TicketDetail, TicketReadError> =>
      Effect.gen(function* () {
        yield* ensureAccess(orgSlug, userId, slug)
        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const projectGithub = yield* projects.getGithubIntegration(
          orgSlug,
          userId,
          slug
        )
        yield* readTicket(orgSlug, slug, id)
        const next = yield* writeGitFields(
          orgSlug,
          slug,
          id,
          indexProject,
          projectGithub,
          {
            branch: null,
            pr: null,
            prState: null,
            lastTransitionedPr: null
          }
        )
        return documentToDetail(next, null)
      })

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
        const branches = [
          ...new Set(
            tickets.flatMap((ticket) =>
              ticket.branch && ticket.branch.length > 0 ? [ticket.branch] : []
            )
          )
        ]
        const result = yield* github
          .fetchInstallationProjectStates(
            projectGithub.installationId,
            projectGithub.repoOwner,
            projectGithub.repoName,
            branches
          )
          .pipe(
            Effect.map((raw) => ({ ok: true as const, raw })),
            Effect.catchTag("RepoGone", () =>
              Effect.succeed({
                ok: false as const,
                tokenStatus: "ok" as const,
                repoStatus: "gone" as const
              })
            ),
            Effect.catchTag("RateLimited", () =>
              Effect.succeed({
                ok: false as const,
                tokenStatus: "ok" as const,
                repoStatus: "ok" as const
              })
            ),
            Effect.catchTag("GitHubError", () =>
              Effect.succeed({
                ok: false as const,
                tokenStatus: "ok" as const,
                repoStatus: "ok" as const
              })
            )
          )

        if (!result.ok) {
          return {
            states: {},
            transitioned: [],
            tokenStatus: result.tokenStatus,
            repoStatus: result.repoStatus
          }
        }

        const plan = planTicketGitStates(
          tickets,
          result.raw,
          yield* DateTime.nowAsDate
        )

        const resurrected = tickets.flatMap((ticket) =>
          ticket.branchDeletedAt !== null &&
          ticket.branch !== null &&
          result.raw.existingBranches.has(ticket.branch)
            ? [ticket.id]
            : []
        )
        yield* ticketIndex.clearBranchStale(indexProject, resurrected)

        for (const write of plan.writes) {
          yield* writeGitFields(
            orgSlug,
            slug,
            write.ticketId,
            indexProject,
            projectGithub,
            write.patch
          ).pipe(
            Effect.catchTag("MalformedTicketDocument", (error) =>
              Effect.logWarning("Skipping unreadable ticket for git state", {
                orgSlug,
                slug,
                ticketId: write.ticketId,
                error
              })
            ),
            Effect.catchTag("NotFound", () =>
              Effect.logDebug("Skipping vanished indexed ticket", {
                orgSlug,
                slug,
                ticketId: write.ticketId
              })
            )
          )
        }

        return {
          states: plan.states,
          transitioned: plan.transitioned,
          tokenStatus: "ok",
          repoStatus: "ok"
        }
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
          states: single ? { [ticketId]: single } : {},
          transitioned: all.transitioned.filter((t) => t.ticketId === ticketId),
          tokenStatus: all.tokenStatus,
          repoStatus: all.repoStatus
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

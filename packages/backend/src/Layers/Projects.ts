import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { and, asc, eq, sql as sqlFragment } from "drizzle-orm"
import { ulid } from "ulid"
import {
  Conflict,
  deriveProjectIdentity,
  Forbidden,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  NotFound,
  paginateSorted,
  ProjectColor,
  ProjectIcon,
  ProjectOwnerRemovalBlocked,
  ProjectKey,
  RepoGone,
  RateLimited,
  Role,
  Validation
} from "@projectproject/shared"
import type { CursorPayload } from "@projectproject/shared"
import type {
  ProjectBanner,
  AddMemberInput,
  AssignableRole,
  ConnectGithubInput,
  CreateProjectInput,
  GithubConnection,
  Member,
  PendingProjectMember,
  Project,
  ProjectDetail,
  ProjectSetup,
  UpdateProjectInput,
  UpdateProjectSetupInput
} from "@projectproject/shared"
import {
  invitation,
  organizationGithubIntegration,
  organizationIntegration,
  projectGithubRepository,
  projectIndex,
  projectIntegrationLink,
  projectInviteGrant,
  projectMember,
  projectStatus
} from "../db/schema"
import { replaceProjectImageReference } from "../projectImageReferences"
import { Db } from "../Services/Db"
import { GitHub } from "../Services/GitHub"
import { ProjectDocs } from "../Services/ProjectDocs"
import { TicketIndex } from "../Services/TicketIndex"
import type { MarkdownError } from "../Services/Markdown"
import type {
  MalformedTicketDocument,
  TicketDocument
} from "../Services/TicketDocs"
import { TicketDocs } from "../Services/TicketDocs"
import * as TicketDocumentLock from "../ticketDocumentLock"
import { Users } from "../Services/Users"
import {
  Projects,
  type ProjectGithubIntegration,
  type ProjectsShape
} from "../Services/Projects"

const MAX_SLUG_ATTEMPTS = 100
const makeRole = Schema.decodeUnknownSync(Role)
const makeAssignableRole = Schema.decodeUnknownSync(
  Schema.Literals(["admin", "member"])
)
const makeProjectKey = Schema.decodeUnknownSync(ProjectKey)
const makeProjectIcon = Schema.decodeUnknownSync(ProjectIcon)
const makeProjectColor = Schema.decodeUnknownSync(ProjectColor)
const defaultSetup = (): ProjectSetup => ({
  workflowReviewedAt: null,
  invitePeopleDismissedAt: null,
  connectGithubDismissedAt: null
})

function withProjectTelemetry<A, E>(
  operation: string,
  orgSlug: string,
  attributes: Record<string, unknown>,
  effect: Effect.Effect<A, E>
): Effect.Effect<A, E> {
  const annotations = { module: "Projects", operation, orgSlug, ...attributes }
  return effect.pipe(
    Effect.withSpan(`Projects.${operation}`, { attributes: annotations }),
    Effect.annotateLogs(annotations)
  )
}

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function uniqueConstraint(error: unknown, constraint: string): boolean {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    if (record.constraint === constraint) return true
    if (
      typeof record.message === "string" &&
      record.message.includes(constraint)
    ) {
      return true
    }
    return [
      record.cause,
      record.error,
      record.originalError,
      record.cause instanceof Error ? record.cause.cause : undefined
    ].some((value) => uniqueConstraint(value, constraint))
  }
  return typeof error === "string" && error.includes(constraint)
}

export const ProjectsLive = Layer.effect(
  Projects,
  Effect.gen(function* () {
    const db = yield* Db
    const withProjectWriteLock = <A, E, R>(
      slug: string,
      effect: Effect.Effect<A, E, R>
    ) =>
      db
        .transaction(() =>
          Effect.gen(function* () {
            yield* db
              .execute(
                sqlFragment`select slug from project_index where slug = ${slug} for update`
              )
              .pipe(Effect.orDie)
            return yield* effect
          })
        )
        .pipe(Effect.catchTag("SqlError", Effect.die))

    const sql = yield* SqlClient.SqlClient
    const projectDocs = yield* ProjectDocs
    const ticketDocs = yield* TicketDocs
    const ticketIndex = yield* TicketIndex
    const users = yield* Users
    const github = yield* GitHub
    const ticketDocumentLock = yield* TicketDocumentLock.TicketDocumentLock

    const orgIdFromSlug = (orgSlug: string): Effect.Effect<string, NotFound> =>
      db.query.organization
        .findFirst({
          columns: { id: true },
          where: {
            RAW: (table, _operators) => _operators.eq(table.slug, orgSlug)!
          }
        })
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row ? Effect.succeed(row.id) : Effect.fail(new NotFound())
          )
        )

    const getIndexRowInOrg = (
      orgSlug: string,
      slug: string
    ): Effect.Effect<typeof projectIndex.$inferSelect, NotFound> =>
      Effect.gen(function* () {
        const organizationId = yield* orgIdFromSlug(orgSlug)
        const row = yield* db.query.projectIndex
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.slug, slug),
                  _operators.eq(table.organizationId, organizationId)
                )!
            }
          })
          .pipe(Effect.orDie)
        return row ?? (yield* new NotFound())
      })

    const orgRoleForUser = (
      organizationId: string,
      userId: string
    ): Effect.Effect<Role | null> =>
      db.query.member
        .findFirst({
          columns: { role: true },
          where: {
            RAW: (table, _operators) =>
              _operators.and(
                _operators.eq(table.organizationId, organizationId),
                _operators.eq(table.userId, userId)
              )!
          }
        })
        .pipe(
          Effect.map((row) => (row ? makeRole(row.role) : null)),
          Effect.orDie
        )

    const findFreeSlug = (base: string): Effect.Effect<string> =>
      Effect.gen(function* () {
        const safeBase = base.length > 0 ? base : "project"
        for (let i = 0; i < MAX_SLUG_ATTEMPTS; i++) {
          const candidate = i === 0 ? safeBase : `${safeBase}-${i + 1}`
          const existing = yield* db.query.projectIndex
            .findFirst({
              columns: { slug: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.eq(table.slug, candidate)!
              }
            })
            .pipe(Effect.orDie)
          if (!existing) return candidate
        }
        return yield* Effect.die(
          new Error(`could not allocate unique slug for "${base}"`)
        )
      })

    const loadMembers = (slug: string): Effect.Effect<ReadonlyArray<Member>> =>
      db.query.projectMember
        .findMany({
          where: {
            RAW: (table, _operators) => _operators.eq(table.projectSlug, slug)!
          },
          columns: { role: true },
          with: {
            user: {
              columns: {
                id: true,
                username: true,
                name: true,
                email: true,
                image: true
              }
            }
          }
        })
        .pipe(
          Effect.map((rows) =>
            rows.map((r): Member => ({
              id: r.user.id,
              username: r.user.username,
              name: r.user.name,
              email: r.user.email,
              image: r.user.image,
              role: makeRole(r.role)
            }))
          ),
          Effect.orDie
        )

    const loadPendingMembers = (
      slug: string
    ): Effect.Effect<ReadonlyArray<PendingProjectMember>> =>
      db
        .select({
          invitationId: projectInviteGrant.invitationId,
          email: invitation.email,
          role: projectInviteGrant.role,
          expiresAt: invitation.expiresAt
        })
        .from(projectInviteGrant)
        .innerJoin(
          invitation,
          eq(invitation.id, projectInviteGrant.invitationId)
        )
        .where(
          and(
            eq(projectInviteGrant.projectSlug, slug),
            eq(invitation.status, "pending")
          )
        )
        .orderBy(asc(invitation.email))
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              invitationId: row.invitationId,
              email: row.email,
              role: makeAssignableRole(row.role),
              expiresAt: row.expiresAt
            }))
          ),
          Effect.orDie
        )

    const loadGithubIntegration = (
      indexRow: typeof projectIndex.$inferSelect
    ): Effect.Effect<ProjectGithubIntegration | null> =>
      db
        .select({
          projectIntegrationLinkId: projectIntegrationLink.id,
          organizationId: projectIntegrationLink.organizationId,
          projectId: projectIntegrationLink.projectId,
          projectSlug: projectIndex.slug,
          installationId: organizationGithubIntegration.installationId,
          repoId: projectGithubRepository.repoId,
          repoOwner: projectGithubRepository.repoOwner,
          repoName: projectGithubRepository.repoName,
          defaultBaseBranch: projectGithubRepository.defaultBranch
        })
        .from(projectIntegrationLink)
        .innerJoin(
          projectIndex,
          eq(projectIndex.id, projectIntegrationLink.projectId)
        )
        .innerJoin(
          projectGithubRepository,
          eq(
            projectGithubRepository.projectIntegrationLinkId,
            projectIntegrationLink.id
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
            eq(projectIntegrationLink.projectId, indexRow.id),
            eq(projectIntegrationLink.provider, "github"),
            eq(projectIntegrationLink.status, "active"),
            eq(projectGithubRepository.status, "active"),
            eq(organizationIntegration.status, "active")
          )
        )
        .limit(1)
        .pipe(
          Effect.map((rows) => rows[0] ?? null),
          Effect.orDie
        )

    const loadGithubConnection = (
      indexRow: typeof projectIndex.$inferSelect
    ): Effect.Effect<GithubConnection | null> =>
      loadGithubIntegration(indexRow).pipe(
        Effect.map((row) =>
          row === null
            ? null
            : {
                repoId: row.repoId,
                repoOwner: row.repoOwner,
                repoName: row.repoName,
                defaultBaseBranch: row.defaultBaseBranch
              }
        )
      )

    const requireOrgOwner = (
      organizationId: string,
      userId: string
    ): Effect.Effect<void, Forbidden> =>
      orgRoleForUser(organizationId, userId).pipe(
        Effect.flatMap((role) =>
          role === "owner" ? Effect.void : Effect.fail(new Forbidden())
        )
      )

    const activeOrganizationGithub = (organizationId: string) =>
      db
        .select({
          integrationId: organizationIntegration.id,
          installationId: organizationGithubIntegration.installationId
        })
        .from(organizationIntegration)
        .innerJoin(
          organizationGithubIntegration,
          eq(
            organizationGithubIntegration.organizationIntegrationId,
            organizationIntegration.id
          )
        )
        .where(
          and(
            eq(organizationIntegration.organizationId, organizationId),
            eq(organizationIntegration.provider, "github"),
            eq(organizationIntegration.status, "active")
          )
        )
        .limit(1)
        .pipe(
          Effect.map((rows) => rows[0] ?? null),
          Effect.orDie
        )

    const list = (
      orgSlug: string,
      userId: string
    ): Effect.Effect<ReadonlyArray<Project>, NotFound> =>
      withProjectTelemetry(
        "list",
        orgSlug,
        { userId },
        Effect.gen(function* () {
          const organizationId = yield* orgIdFromSlug(orgSlug)
          const orgRole = yield* orgRoleForUser(organizationId, userId)
          const baseSelect = {
            banner: projectIndex.banner,
            slug: projectIndex.slug,
            key: projectIndex.key,
            name: projectIndex.name,
            icon: projectIndex.icon,
            color: projectIndex.color,
            createdBy: projectIndex.createdBy,
            createdAt: projectIndex.createdAt
          }
          const rows =
            orgRole === "owner" || orgRole === "admin"
              ? yield* db
                  .select(baseSelect)
                  .from(projectIndex)
                  .where(eq(projectIndex.organizationId, organizationId))
                  .orderBy(asc(projectIndex.createdAt))
                  .pipe(Effect.orDie)
              : yield* db
                  .select(baseSelect)
                  .from(projectIndex)
                  .innerJoin(
                    projectMember,
                    and(
                      eq(projectMember.projectSlug, projectIndex.slug),
                      eq(projectMember.userId, userId)
                    )
                  )
                  .where(eq(projectIndex.organizationId, organizationId))
                  .orderBy(asc(projectIndex.createdAt))
                  .pipe(Effect.orDie)
          return rows.map((r) => ({
            banner: r.banner,
            org: orgSlug,
            slug: r.slug,
            key: makeProjectKey(r.key),
            name: r.name,
            icon: makeProjectIcon(r.icon),
            color: makeProjectColor(r.color),
            createdBy: r.createdBy,
            createdAt: r.createdAt
          }))
        })
      )

    const projectSortKey = (p: { createdAt: Date; slug: string }) =>
      `${(Number.MAX_SAFE_INTEGER - p.createdAt.getTime())
        .toString()
        .padStart(20, "0")}|${p.slug}`

    const listPaged = (
      orgSlug: string,
      userId: string,
      cursor: CursorPayload | undefined,
      limit: number
    ): Effect.Effect<
      { items: ReadonlyArray<Project>; nextCursor: string | null },
      NotFound
    > =>
      Effect.gen(function* () {
        const all = yield* list(orgSlug, userId)
        const sorted = [...all].toSorted((a, b) => {
          const dt = b.createdAt.getTime() - a.createdAt.getTime()
          if (dt !== 0) return dt
          return a.slug.localeCompare(b.slug)
        })
        return paginateSorted(sorted, {
          cursor,
          limit,
          sortKey: projectSortKey,
          id: (p) => p.slug
        })
      })

    const listMembersPaged = (
      orgSlug: string,
      userId: string,
      slug: string,
      cursor: CursorPayload | undefined,
      limit: number
    ): Effect.Effect<
      { items: ReadonlyArray<Member>; nextCursor: string | null },
      NotFound
    > =>
      Effect.gen(function* () {
        const detail = yield* get(orgSlug, userId, slug).pipe(
          Effect.catchTag("MarkdownError", (e) => Effect.die(e))
        )
        const sorted = [...detail.members].toSorted((a, b) =>
          a.name < b.name
            ? -1
            : a.name > b.name
              ? 1
              : a.id < b.id
                ? -1
                : a.id > b.id
                  ? 1
                  : 0
        )
        return paginateSorted(sorted, {
          cursor,
          limit,
          sortKey: (m) => m.name,
          id: (m) => m.id
        })
      })

    const requireMemberContext = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<
      { role: Role; indexRow: typeof projectIndex.$inferSelect },
      NotFound
    > =>
      withProjectTelemetry(
        "requireMember",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          const explicit = yield* db.query.projectMember
            .findFirst({
              columns: { role: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.userId, userId)
                  )!
              }
            })
            .pipe(Effect.orDie)
          const explicitRole = explicit ? makeRole(explicit.role) : null
          if (explicitRole === "owner")
            return { role: "owner" as const, indexRow }
          const orgRole = yield* orgRoleForUser(indexRow.organizationId, userId)
          if (orgRole === "owner" || orgRole === "admin") {
            return { role: "admin" as const, indexRow }
          }
          if (explicitRole) return { role: explicitRole, indexRow }
          return yield* new NotFound()
        })
      )

    const requireMember = (orgSlug: string, userId: string, slug: string) =>
      requireMemberContext(orgSlug, userId, slug).pipe(
        Effect.map(({ role }) => ({ role }))
      )

    const requireRole = (
      orgSlug: string,
      userId: string,
      slug: string,
      allowed: ReadonlyArray<Role>
    ): Effect.Effect<{ role: Role }, NotFound | Forbidden> =>
      Effect.gen(function* () {
        const ctx = yield* requireMember(orgSlug, userId, slug)
        if (!allowed.includes(ctx.role)) {
          return yield* new Forbidden()
        }
        return ctx
      })

    const getKey = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<ProjectKey, NotFound> =>
      withProjectTelemetry(
        "getKey",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          const { indexRow } = yield* requireMemberContext(
            orgSlug,
            userId,
            slug
          )
          return yield* Effect.sync(() => makeProjectKey(indexRow.key)).pipe(
            Effect.orDie
          )
        })
      )

    const getGithubIntegration = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<ProjectGithubIntegration | null, NotFound> =>
      Effect.gen(function* () {
        const { indexRow } = yield* requireMemberContext(orgSlug, userId, slug)
        return yield* loadGithubIntegration(indexRow)
      })

    const syncFrontmatter = (
      orgSlug: string,
      slug: string,
      name: string,
      icon: string,
      color: string,
      createdBy: string,
      createdAt: Date,
      key: ProjectKey,
      body: string,
      members: ReadonlyArray<Member>,
      connection: GithubConnection | null,
      setup: ProjectSetup,
      banner: ProjectBanner | null = null
    ): Effect.Effect<void, MarkdownError> =>
      projectDocs.write(orgSlug, slug, {
        org: orgSlug,
        slug,
        key,
        name,
        icon,
        color,
        createdBy,
        createdAt,
        members: members.map((m) => ({
          username: m.username ?? m.email,
          role: m.role
        })),
        github: connection,
        banner,
        setup,
        body
      })

    const create = (
      orgSlug: string,
      createdBy: string,
      input: CreateProjectInput
    ): Effect.Effect<Project, NotFound | Conflict> =>
      withProjectTelemetry(
        "create",
        orgSlug,
        { createdBy, projectName: input.name, projectKey: input.key },
        Effect.gen(function* () {
          const organizationId = yield* orgIdFromSlug(orgSlug)
          const slug = yield* findFreeSlug(slugify(input.name))
          const createdAt = yield* DateTime.nowAsDate
          const key = makeProjectKey(input.key)
          const identityRaw = deriveProjectIdentity(slug)
          const identity = {
            icon: makeProjectIcon(identityRaw.icon),
            color: makeProjectColor(identityRaw.color)
          }
          const existingKey = yield* db.query.projectIndex
            .findFirst({
              columns: { slug: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.organizationId, organizationId),
                    _operators.eq(table.key, input.key)
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (existingKey) {
            return yield* new Conflict({ reason: "project_key_taken" })
          }

          const [row] = yield* db
            .insert(projectIndex)
            .values({
              slug,
              key,
              name: input.name,
              icon: identity.icon,
              color: identity.color,
              createdBy,
              createdAt,
              organizationId
            })
            .returning()
            .pipe(
              Effect.catch((cause) =>
                uniqueConstraint(cause, "project_index_organization_key_uidx")
                  ? Effect.fail(new Conflict({ reason: "project_key_taken" }))
                  : Effect.die(cause)
              )
            )

          yield* db
            .insert(projectMember)
            .values({
              projectSlug: slug,
              projectId: row.id,
              userId: createdBy,
              role: "owner"
            })
            .pipe(Effect.orDie)

          yield* db
            .insert(projectStatus)
            .values([
              {
                projectId: row.id,
                slug: "todo",
                label: "Todo",
                icon: "CircleDashed",
                color: "#a3a3a3",
                orderKey: "a0",
                createdBy
              },
              {
                projectId: row.id,
                slug: "in_progress",
                label: "In progress",
                icon: "CircleDot",
                color: "#3b82f6",
                orderKey: "a1",
                createdBy
              },
              {
                projectId: row.id,
                slug: "done",
                label: "Done",
                icon: "CircleCheck",
                color: "#22c55e",
                orderKey: "a2",
                createdBy
              }
            ])
            .pipe(Effect.orDie)

          const rollback = db
            .delete(projectIndex)
            .where(eq(projectIndex.slug, slug))
            .pipe(Effect.orDie)

          const members = yield* loadMembers(slug)
          yield* syncFrontmatter(
            orgSlug,
            slug,
            input.name,
            identity.icon,
            identity.color,
            createdBy,
            createdAt,
            key,
            `# ${input.name}\n`,
            members,
            null,
            defaultSetup()
          ).pipe(
            Effect.catch((cause) =>
              rollback.pipe(Effect.andThen(Effect.die(cause)))
            )
          )

          return {
            org: orgSlug,
            slug: row.slug,
            key: makeProjectKey(row.key),
            name: row.name,
            icon: makeProjectIcon(row.icon),
            color: makeProjectColor(row.color),
            createdBy: row.createdBy,
            createdAt: row.createdAt,
            banner: null
          }
        })
      )

    const get = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<ProjectDetail, NotFound | MarkdownError> =>
      withProjectTelemetry(
        "get",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          const { indexRow } = yield* requireMemberContext(
            orgSlug,
            userId,
            slug
          )
          const file = yield* projectDocs.read(orgSlug, slug)
          const members = yield* loadMembers(slug)
          const pendingMembers = yield* loadPendingMembers(slug)
          const connection = yield* loadGithubConnection(indexRow)
          const key = makeProjectKey(indexRow.key)
          return {
            org: orgSlug,
            slug: indexRow.slug,
            key,
            name: indexRow.name,
            icon: makeProjectIcon(indexRow.icon),
            color: makeProjectColor(indexRow.color),
            createdBy: indexRow.createdBy,
            createdAt: indexRow.createdAt,
            github: connection,
            banner: file.banner ?? null,
            setup: file.setup,
            body: file.body,
            members,
            pendingMembers
          }
        })
      )

    const update = (
      orgSlug: string,
      userId: string,
      slug: string,
      input: UpdateProjectInput
    ): Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "update",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          yield* requireRole(orgSlug, userId, slug, ["owner", "admin"])
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          const file = yield* projectDocs.read(orgSlug, slug)
          const connection = yield* loadGithubConnection(indexRow)

          const nextBanner =
            input.banner === undefined ? (file.banner ?? null) : input.banner
          if (input.banner !== undefined) {
            yield* replaceProjectImageReference(db, {
              orgSlug,
              projectSlug: slug,
              slot: "banner",
              attachmentId:
                nextBanner?.type === "attachment"
                  ? nextBanner.attachmentId
                  : null
            })
          }

          const nextName = input.name ?? indexRow.name
          const nextBody = input.body ?? file.body
          const nextIcon = input.icon ?? makeProjectIcon(indexRow.icon)
          const nextColor = input.color ?? makeProjectColor(indexRow.color)

          const dbPatch: Partial<typeof projectIndex.$inferInsert> = {}
          if (input.banner !== undefined) dbPatch.banner = nextBanner
          if (input.name !== undefined && input.name !== indexRow.name) {
            dbPatch.name = nextName
          }
          if (input.icon !== undefined && input.icon !== indexRow.icon) {
            dbPatch.icon = nextIcon
          }
          if (input.color !== undefined && input.color !== indexRow.color) {
            dbPatch.color = nextColor
          }
          if (Object.keys(dbPatch).length > 0) {
            yield* db
              .update(projectIndex)
              .set(dbPatch)
              .where(eq(projectIndex.slug, slug))
              .pipe(Effect.orDie)
          }

          const members = yield* loadMembers(slug)
          const pendingMembers = yield* loadPendingMembers(slug)
          yield* syncFrontmatter(
            orgSlug,
            slug,
            nextName,
            nextIcon,
            nextColor,
            indexRow.createdBy,
            indexRow.createdAt,
            makeProjectKey(indexRow.key),
            nextBody,
            members,
            connection,
            file.setup,
            nextBanner
          )

          return {
            org: orgSlug,
            slug,
            key: makeProjectKey(indexRow.key),
            name: nextName,
            icon: nextIcon,
            color: nextColor,
            createdBy: indexRow.createdBy,
            createdAt: indexRow.createdAt,
            github: connection,
            banner: nextBanner,
            setup: file.setup,
            body: nextBody,
            members,
            pendingMembers
          }
        }).pipe((effect) => withProjectWriteLock(slug, effect))
      )

    const updateSetup = (
      orgSlug: string,
      userId: string,
      slug: string,
      input: UpdateProjectSetupInput
    ): Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "updateSetup",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          yield* requireRole(orgSlug, userId, slug, ["owner", "admin"])
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          const file = yield* projectDocs.read(orgSlug, slug)
          const connection = yield* loadGithubConnection(indexRow)
          const members = yield* loadMembers(slug)
          const pendingMembers = yield* loadPendingMembers(slug)
          const setup = { ...file.setup, ...input }
          yield* syncFrontmatter(
            orgSlug,
            slug,
            indexRow.name,
            indexRow.icon,
            indexRow.color,
            indexRow.createdBy,
            indexRow.createdAt,
            makeProjectKey(indexRow.key),
            file.body,
            members,
            connection,
            setup,
            file.banner ?? null
          )
          return {
            org: orgSlug,
            slug,
            key: makeProjectKey(indexRow.key),
            name: indexRow.name,
            icon: makeProjectIcon(indexRow.icon),
            color: makeProjectColor(indexRow.color),
            createdBy: indexRow.createdBy,
            createdAt: indexRow.createdAt,
            github: connection,
            setup,
            banner: file.banner ?? null,
            body: file.body,
            members,
            pendingMembers
          }
        }).pipe((effect) => withProjectWriteLock(slug, effect))
      )

    const remove = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<void, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "remove",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          yield* requireRole(orgSlug, userId, slug, ["owner"])
          yield* projectDocs.removeDir(orgSlug, slug)
          yield* db
            .delete(projectIndex)
            .where(eq(projectIndex.slug, slug))
            .pipe(Effect.orDie)
        })
      )

    const replayDetail = (
      orgSlug: string,
      slug: string
    ): Effect.Effect<ProjectDetail, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
        const file = yield* projectDocs.read(orgSlug, slug)
        const connection = yield* loadGithubConnection(indexRow)
        const members = yield* loadMembers(slug)
        const pendingMembers = yield* loadPendingMembers(slug)
        yield* syncFrontmatter(
          orgSlug,
          slug,
          indexRow.name,
          indexRow.icon,
          indexRow.color,
          indexRow.createdBy,
          indexRow.createdAt,
          makeProjectKey(indexRow.key),
          file.body,
          members,
          connection,
          file.setup,
          file.banner ?? null
        )
        return {
          org: orgSlug,
          slug: indexRow.slug,
          key: makeProjectKey(indexRow.key),
          name: indexRow.name,
          icon: makeProjectIcon(indexRow.icon),
          color: makeProjectColor(indexRow.color),
          createdBy: indexRow.createdBy,
          createdAt: indexRow.createdAt,
          github: connection,
          banner: file.banner ?? null,
          setup: file.setup,
          body: file.body,
          members,
          pendingMembers
        }
      }).pipe((effect) => withProjectWriteLock(slug, effect))

    const unassignUserFromActiveTickets = (
      orgSlug: string,
      slug: string,
      userId: string
    ): Effect.Effect<void, MarkdownError | MalformedTicketDocument> =>
      Effect.gen(function* () {
        const project = yield* ticketIndex
          .projectFor(orgSlug, slug)
          .pipe(Effect.orDie)
        const tickets = yield* ticketIndex.list(project)
        const ids = tickets
          .filter(
            (ticket) =>
              ticket.status !== "done" && ticket.assignees.includes(userId)
          )
          .map((ticket) => ticket.id)
        yield* Effect.forEach(
          ids,
          (id) =>
            ticketDocs
              .update(
                orgSlug,
                slug,
                id,
                (ticket) => {
                  if (
                    ticket.status === "done" ||
                    !ticket.assignees.includes(userId)
                  ) {
                    return Effect.succeed(ticket)
                  }
                  return DateTime.nowAsDate.pipe(
                    Effect.map((updatedAt) => ({
                      ...ticket,
                      assignees: ticket.assignees.filter((id) => id !== userId),
                      updatedAt
                    }))
                  )
                },
                (next) => ticketIndex.upsertTicket(project, next)
              )
              .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null))),
          { concurrency: 8 }
        )
      })

    const withClearedTicketPrMetadata = <A, E, R>(
      orgSlug: string,
      slug: string,
      switchRepository: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | MarkdownError, R> =>
      Effect.gen(function* () {
        const project = yield* ticketIndex
          .projectFor(orgSlug, slug)
          .pipe(Effect.orDie)
        const ids = yield* ticketDocs.listIds(orgSlug, slug)
        const originals: Array<TicketDocument> = []
        const clearAndSwitch = Effect.gen(function* () {
          for (const id of ids) {
            const ticket = yield* ticketDocs.read(orgSlug, slug, id).pipe(
              Effect.catchTags({
                NotFound: () => Effect.succeed(null),
                MalformedTicketDocument: (error) =>
                  Effect.logWarning(
                    "Skipping unreadable ticket pr metadata"
                  ).pipe(
                    Effect.annotateLogs({ orgSlug, slug, ticketId: id, error }),
                    Effect.as(null)
                  )
              })
            )
            if (
              ticket === null ||
              (ticket.pr === null &&
                ticket.prState === null &&
                ticket.lastTransitionedPr === null)
            ) {
              continue
            }
            const next = {
              ...ticket,
              pr: null,
              prState: null,
              lastTransitionedPr: null,
              updatedAt: yield* DateTime.nowAsDate
            }
            yield* ticketDocs
              .update(
                orgSlug,
                slug,
                id,
                (current) =>
                  Effect.succeed({
                    ...current,
                    pr: next.pr,
                    prState: next.prState,
                    lastTransitionedPr: next.lastTransitionedPr,
                    updatedAt: next.updatedAt
                  }),
                (updated) =>
                  Effect.gen(function* () {
                    originals.push(ticket)
                    yield* ticketIndex.upsertTicket(project, updated)
                  })
              )
              .pipe(
                Effect.catchTags({
                  NotFound: () => Effect.void,
                  MalformedTicketDocument: (error) =>
                    Effect.logWarning(
                      "Skipping unreadable ticket pr metadata",
                      { orgSlug, slug, ticketId: id, error }
                    )
                })
              )
          }
          return yield* switchRepository
        }).pipe(
          Effect.onError(() =>
            Effect.forEach(
              originals,
              (ticket) =>
                ticketDocs.update(
                  orgSlug,
                  slug,
                  ticket.id,
                  (current) =>
                    Effect.succeed({
                      ...current,
                      pr: ticket.pr,
                      prState: ticket.prState,
                      lastTransitionedPr: ticket.lastTransitionedPr,
                      updatedAt: ticket.updatedAt
                    }),
                  (restored) => ticketIndex.upsertTicket(project, restored)
                ),
              { discard: true }
            ).pipe(Effect.orDie)
          ),
          Effect.uninterruptible
        )
        return yield* [...ids]
          .sort()
          .reduceRight(
            (effect, id) =>
              ticketDocumentLock.withTicketDocumentLock(
                orgSlug,
                slug,
                id,
                effect
              ),
            clearAndSwitch
          )
      })

    const attachProjectInviteGrant = (
      orgSlug: string,
      inviterId: string,
      email: string,
      indexRow: typeof projectIndex.$inferSelect,
      role: AssignableRole,
      callerRole: Role
    ): Effect.Effect<void, NotFound | Forbidden> =>
      Effect.gen(function* () {
        const organizationId = yield* orgIdFromSlug(orgSlug)
        const normalizedEmail = email.toLowerCase()
        const now = yield* DateTime.now
        const expiresAt = DateTime.toDate(DateTime.add(now, { hours: 48 }))
        const existing = yield* db.query.invitation
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.organizationId, organizationId),
                  _operators.eq(table.email, normalizedEmail),
                  _operators.eq(table.status, "pending")
                )!
            }
          })
          .pipe(Effect.orDie)
        const invite =
          existing ??
          (yield* Effect.gen(function* () {
            const id = yield* Effect.sync(() => ulid())
            const [created] = yield* db
              .insert(invitation)
              .values({
                id,
                organizationId,
                email: normalizedEmail,
                role: "member",
                status: "pending",
                expiresAt,
                inviterId
              })
              .returning()
              .pipe(Effect.orDie)
            yield* Effect.logInfo("invitation issued").pipe(
              Effect.annotateLogs({
                orgSlug,
                role: "member",
                inviteId: created.id
              })
            )
            return created
          }))

        const existingGrant = yield* db.query.projectInviteGrant
          .findFirst({
            columns: { role: true },
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.invitationId, invite.id),
                  _operators.eq(table.projectSlug, indexRow.slug)
                )!
            }
          })
          .pipe(Effect.orDie)
        if (
          existingGrant &&
          makeAssignableRole(existingGrant.role) !== role &&
          callerRole !== "owner"
        ) {
          return yield* new Forbidden()
        }

        yield* db
          .update(invitation)
          .set({ expiresAt })
          .where(eq(invitation.id, invite.id))
          .pipe(Effect.orDie)

        yield* db
          .insert(projectInviteGrant)
          .values({
            invitationId: invite.id,
            projectSlug: indexRow.slug,
            projectId: indexRow.id,
            role
          })
          .onConflictDoUpdate({
            target: [
              projectInviteGrant.invitationId,
              projectInviteGrant.projectSlug
            ],
            set: { projectId: indexRow.id, role }
          })
          .pipe(Effect.orDie)
      })

    const addMember = (
      orgSlug: string,
      userId: string,
      slug: string,
      input: AddMemberInput
    ): Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "addMember",
        orgSlug,
        { slug, userId, targetEmail: input.email, targetRole: input.role },
        Effect.gen(function* () {
          const callerCtx = yield* requireRole(orgSlug, userId, slug, [
            "owner",
            "admin"
          ])
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          if (input.role === "admin" && callerCtx.role !== "owner") {
            return yield* new Forbidden()
          }
          const organizationId = yield* orgIdFromSlug(orgSlug)
          const email = input.email.trim().toLowerCase()
          const target = yield* users.findByEmail(email)
          const targetOrgMember =
            target === null
              ? null
              : yield* db.query.member
                  .findFirst({
                    columns: { id: true },
                    where: {
                      RAW: (table, _operators) =>
                        _operators.and(
                          _operators.eq(table.organizationId, organizationId),
                          _operators.eq(table.userId, target.id)
                        )!
                    }
                  })
                  .pipe(Effect.orDie)

          if (target === null || targetOrgMember == null) {
            yield* attachProjectInviteGrant(
              orgSlug,
              userId,
              email,
              indexRow,
              input.role,
              callerCtx.role
            )
            return yield* replayDetail(orgSlug, slug)
          }

          const existing = yield* db.query.projectMember
            .findFirst({
              columns: { role: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.userId, target.id)
                  )!
              }
            })
            .pipe(Effect.orDie)

          if (existing) {
            const currentRole = makeRole(existing.role)
            if (currentRole !== input.role) {
              if (currentRole === "owner") {
                return yield* new Forbidden()
              }
              const callerCtx = yield* requireMember(orgSlug, userId, slug)
              if (callerCtx.role !== "owner") {
                return yield* new Forbidden()
              }
              yield* db
                .update(projectMember)
                .set({ projectId: indexRow.id, role: input.role })
                .where(
                  and(
                    eq(projectMember.projectSlug, slug),
                    eq(projectMember.userId, target.id)
                  )
                )
                .pipe(Effect.orDie)
            }
          } else {
            yield* db
              .insert(projectMember)
              .values({
                projectSlug: slug,
                projectId: indexRow.id,
                userId: target.id,
                role: input.role
              })
              .pipe(Effect.orDie)
          }

          return yield* replayDetail(orgSlug, slug)
        })
      )

    const cancelPendingMember = (
      orgSlug: string,
      userId: string,
      slug: string,
      invitationId: string
    ): Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "cancelPendingMember",
        orgSlug,
        { slug, userId, invitationId },
        Effect.gen(function* () {
          const callerCtx = yield* requireRole(orgSlug, userId, slug, [
            "owner",
            "admin"
          ])
          const existing = yield* db
            .select({
              role: projectInviteGrant.role,
              status: invitation.status
            })
            .from(projectInviteGrant)
            .innerJoin(
              invitation,
              eq(invitation.id, projectInviteGrant.invitationId)
            )
            .where(
              and(
                eq(projectInviteGrant.projectSlug, slug),
                eq(projectInviteGrant.invitationId, invitationId)
              )
            )
            .limit(1)
            .pipe(Effect.orDie)
          const pending = existing[0]
          if (!pending || pending.status !== "pending") {
            return yield* new NotFound()
          }
          if (
            makeAssignableRole(pending.role) === "admin" &&
            callerCtx.role !== "owner"
          ) {
            return yield* new Forbidden()
          }
          yield* db
            .delete(projectInviteGrant)
            .where(
              and(
                eq(projectInviteGrant.projectSlug, slug),
                eq(projectInviteGrant.invitationId, invitationId)
              )
            )
            .pipe(Effect.orDie)
          const remaining = yield* db.query.projectInviteGrant
            .findFirst({
              columns: { invitationId: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.eq(table.invitationId, invitationId)!
              }
            })
            .pipe(Effect.orDie)
          if (!remaining) {
            yield* db
              .update(invitation)
              .set({ status: "canceled" })
              .where(eq(invitation.id, invitationId))
              .pipe(Effect.orDie)
          }
          return yield* replayDetail(orgSlug, slug)
        })
      )

    const updateMember = (
      orgSlug: string,
      userId: string,
      slug: string,
      targetUserId: string,
      nextRole: AssignableRole
    ): Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "updateMember",
        orgSlug,
        { slug, userId, targetUserId, nextRole },
        Effect.gen(function* () {
          yield* requireRole(orgSlug, userId, slug, ["owner"])
          const existing = yield* db.query.projectMember
            .findFirst({
              columns: { role: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.userId, targetUserId)
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (!existing) return yield* new NotFound()
          if (makeRole(existing.role) === "owner") {
            return yield* new Forbidden()
          }
          yield* db
            .update(projectMember)
            .set({ role: nextRole })
            .where(
              and(
                eq(projectMember.projectSlug, slug),
                eq(projectMember.userId, targetUserId)
              )
            )
            .pipe(Effect.orDie)
          return yield* replayDetail(orgSlug, slug)
        })
      )

    const transferOwnership = (
      orgSlug: string,
      userId: string,
      slug: string,
      targetUserId: string
    ): Effect.Effect<
      ProjectDetail,
      NotFound | Forbidden | Validation | MarkdownError
    > =>
      withProjectTelemetry(
        "transferOwnership",
        orgSlug,
        { slug, userId, targetUserId },
        Effect.gen(function* () {
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          const organizationId = indexRow.organizationId ?? ""
          const callerProjectRole = yield* db.query.projectMember
            .findFirst({
              columns: { role: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.userId, userId)
                  )!
              }
            })
            .pipe(Effect.orDie)
          const callerOrgRole = yield* orgRoleForUser(organizationId, userId)
          const canTransfer =
            callerProjectRole?.role === "owner" || callerOrgRole === "owner"
          if (!canTransfer) return yield* new Forbidden()

          const owners = yield* db.query.projectMember
            .findMany({
              columns: { userId: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.role, "owner")
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (owners.length !== 1) {
            return yield* new Validation({
              reason: "invalid_project_owner_count"
            })
          }
          const sourceUserId = owners[0].userId
          if (targetUserId === sourceUserId) {
            return yield* new Validation({
              reason: "target_is_current_owner"
            })
          }

          const target = yield* db.query.projectMember
            .findFirst({
              columns: { userId: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.userId, targetUserId)
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (!target) return yield* new NotFound()

          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const currentOwners = yield* db.query.projectMember
                  .findMany({
                    columns: { userId: true },
                    where: {
                      RAW: (table, _operators) =>
                        _operators.and(
                          _operators.eq(table.projectSlug, slug),
                          _operators.eq(table.role, "owner")
                        )!
                    }
                  })
                  .pipe(Effect.orDie)
                if (
                  currentOwners.length !== 1 ||
                  currentOwners[0].userId !== sourceUserId
                ) {
                  return yield* new Validation({
                    reason: "invalid_project_owner_count"
                  })
                }

                const currentTarget = yield* db.query.projectMember
                  .findFirst({
                    columns: { userId: true },
                    where: {
                      RAW: (table, _operators) =>
                        _operators.and(
                          _operators.eq(table.projectSlug, slug),
                          _operators.eq(table.userId, targetUserId)
                        )!
                    }
                  })
                  .pipe(Effect.orDie)
                if (!currentTarget) return yield* new NotFound()

                const demoted = yield* db
                  .update(projectMember)
                  .set({ role: "admin" })
                  .where(
                    and(
                      eq(projectMember.projectSlug, slug),
                      eq(projectMember.userId, sourceUserId),
                      eq(projectMember.role, "owner")
                    )
                  )
                  .returning({ userId: projectMember.userId })
                  .pipe(Effect.orDie)
                if (demoted.length !== 1) {
                  return yield* new Validation({ reason: "transfer_failed" })
                }

                const promoted = yield* db
                  .update(projectMember)
                  .set({ role: "owner" })
                  .where(
                    and(
                      eq(projectMember.projectSlug, slug),
                      eq(projectMember.userId, targetUserId)
                    )
                  )
                  .returning({ userId: projectMember.userId })
                  .pipe(Effect.orDie)
                if (promoted.length !== 1) {
                  return yield* new Validation({ reason: "transfer_failed" })
                }
              })
            )
            .pipe(Effect.catchTag("SqlError", Effect.die))

          return yield* replayDetail(orgSlug, slug)
        })
      )

    const removeMember = (
      orgSlug: string,
      userId: string,
      slug: string,
      targetUserId: string
    ): Effect.Effect<
      ProjectDetail,
      | NotFound
      | Forbidden
      | MarkdownError
      | MalformedTicketDocument
      | ProjectOwnerRemovalBlocked
    > =>
      withProjectTelemetry(
        "removeMember",
        orgSlug,
        { slug, userId, targetUserId },
        Effect.gen(function* () {
          const callerCtx = yield* requireRole(orgSlug, userId, slug, [
            "owner",
            "admin"
          ])
          const existing = yield* db.query.projectMember
            .findFirst({
              columns: { role: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectSlug, slug),
                    _operators.eq(table.userId, targetUserId)
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (!existing) return yield* new NotFound()
          const targetRole = makeRole(existing.role)
          if (targetRole === "owner") {
            return yield* new ProjectOwnerRemovalBlocked({
              projectSlugs: [slug]
            })
          }
          if (targetRole === "admin" && callerCtx.role !== "owner") {
            return yield* new Forbidden()
          }
          yield* unassignUserFromActiveTickets(orgSlug, slug, targetUserId)
          yield* db
            .delete(projectMember)
            .where(
              and(
                eq(projectMember.projectSlug, slug),
                eq(projectMember.userId, targetUserId)
              )
            )
            .pipe(Effect.orDie)
          return yield* replayDetail(orgSlug, slug)
        })
      )

    const connectGithub = (
      orgSlug: string,
      userId: string,
      slug: string,
      input: ConnectGithubInput
    ): Effect.Effect<
      ProjectDetail,
      | NotFound
      | Forbidden
      | Conflict
      | GitHubTokenExpired
      | GitHubScopeInsufficient
      | RepoGone
      | RateLimited
      | GitHubError
      | MarkdownError
    > =>
      withProjectTelemetry(
        "connectGithub",
        orgSlug,
        {
          slug,
          userId,
          repoOwner: input.repoOwner,
          repoName: input.repoName
        },
        Effect.gen(function* () {
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          yield* requireOrgOwner(indexRow.organizationId, userId)
          const orgGithub = yield* activeOrganizationGithub(
            indexRow.organizationId
          )
          if (!orgGithub) return yield* new NotFound()
          const file = yield* projectDocs.read(orgSlug, slug)
          const currentConnection = yield* loadGithubConnection(indexRow)

          const verified = yield* github.verifyInstallationRepo(
            orgGithub.installationId,
            input.repoOwner,
            input.repoName
          )
          if (verified.repoId !== input.repoId) {
            return yield* new RepoGone()
          }

          const next: GithubConnection = {
            repoId: verified.repoId,
            repoOwner: verified.owner,
            repoName: verified.name,
            defaultBaseBranch:
              input.defaultBaseBranch === undefined
                ? verified.defaultBranch
                : input.defaultBaseBranch
          }

          const now = yield* DateTime.nowAsDate
          const repoChanged =
            currentConnection !== null &&
            (currentConnection.repoId !== next.repoId ||
              currentConnection.repoOwner !== next.repoOwner ||
              currentConnection.repoName !== next.repoName)
          const switchRepository = sql
            .withTransaction(
              Effect.gen(function* () {
                const activeLinks = yield* db
                  .update(projectIntegrationLink)
                  .set({
                    status: "disconnected",
                    disconnectedAt: now,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(projectIntegrationLink.projectId, indexRow.id),
                      eq(projectIntegrationLink.provider, "github"),
                      eq(projectIntegrationLink.status, "active")
                    )
                  )
                  .returning({ id: projectIntegrationLink.id })
                  .pipe(Effect.orDie)

                yield* Effect.forEach(
                  activeLinks,
                  (link) =>
                    db
                      .update(projectGithubRepository)
                      .set({ status: "disconnected" })
                      .where(
                        eq(
                          projectGithubRepository.projectIntegrationLinkId,
                          link.id
                        )
                      )
                      .pipe(Effect.asVoid, Effect.orDie),
                  { concurrency: 1 }
                )

                const [link] = yield* db
                  .insert(projectIntegrationLink)
                  .values({
                    projectId: indexRow.id,
                    organizationId: indexRow.organizationId,
                    organizationIntegrationId: orgGithub.integrationId,
                    provider: "github",
                    status: "active",
                    lastCheckedAt: now,
                    lastCheckStatus: "ok"
                  })
                  .returning()
                  .pipe(
                    Effect.catch((cause) =>
                      uniqueConstraint(
                        cause,
                        "project_integration_link_active_provider_uidx"
                      )
                        ? Effect.fail(
                            new Conflict({
                              reason: "github_repo_already_connected"
                            })
                          )
                        : Effect.die(cause)
                    )
                  )

                yield* db
                  .insert(projectGithubRepository)
                  .values({
                    projectIntegrationLinkId: link.id,
                    organizationId: indexRow.organizationId,
                    status: "active",
                    repoId: verified.repoId,
                    repoOwner: verified.owner,
                    repoName: verified.name,
                    defaultBranch:
                      next.defaultBaseBranch ?? verified.defaultBranch
                  })
                  .pipe(
                    Effect.catch((cause) =>
                      uniqueConstraint(
                        cause,
                        "project_github_repository_active_repo_uidx"
                      )
                        ? Effect.fail(
                            new Conflict({
                              reason: "github_repo_already_connected"
                            })
                          )
                        : Effect.die(cause)
                    )
                  )
              })
            )
            .pipe(Effect.catchTag("SqlError", Effect.die))

          yield* repoChanged
            ? withClearedTicketPrMetadata(orgSlug, slug, switchRepository)
            : switchRepository

          const members = yield* loadMembers(slug)
          const pendingMembers = yield* loadPendingMembers(slug)
          yield* syncFrontmatter(
            orgSlug,
            slug,
            indexRow.name,
            indexRow.icon,
            indexRow.color,
            indexRow.createdBy,
            indexRow.createdAt,
            makeProjectKey(indexRow.key),
            file.body,
            members,
            next,
            file.setup,
            file.banner ?? null
          )

          return {
            org: orgSlug,
            slug: indexRow.slug,
            key: makeProjectKey(indexRow.key),
            name: indexRow.name,
            icon: makeProjectIcon(indexRow.icon),
            color: makeProjectColor(indexRow.color),
            createdBy: indexRow.createdBy,
            createdAt: indexRow.createdAt,
            github: next,
            banner: file.banner ?? null,
            setup: file.setup,
            body: file.body,
            members,
            pendingMembers
          }
        }).pipe((effect) => withProjectWriteLock(slug, effect))
      )

    const disconnectGithub = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError> =>
      withProjectTelemetry(
        "disconnectGithub",
        orgSlug,
        { slug, userId },
        Effect.gen(function* () {
          const indexRow = yield* getIndexRowInOrg(orgSlug, slug)
          yield* requireOrgOwner(indexRow.organizationId, userId)
          const file = yield* projectDocs.read(orgSlug, slug)
          const members = yield* loadMembers(slug)
          const pendingMembers = yield* loadPendingMembers(slug)
          const now = yield* DateTime.nowAsDate
          yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const activeLinks = yield* db
                  .update(projectIntegrationLink)
                  .set({
                    status: "disconnected",
                    disconnectedAt: now,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(projectIntegrationLink.projectId, indexRow.id),
                      eq(projectIntegrationLink.provider, "github"),
                      eq(projectIntegrationLink.status, "active")
                    )
                  )
                  .returning({ id: projectIntegrationLink.id })
                  .pipe(Effect.orDie)
                yield* Effect.forEach(
                  activeLinks,
                  (link) =>
                    db
                      .update(projectGithubRepository)
                      .set({ status: "disconnected" })
                      .where(
                        eq(
                          projectGithubRepository.projectIntegrationLinkId,
                          link.id
                        )
                      )
                      .pipe(Effect.asVoid, Effect.orDie),
                  { concurrency: 1 }
                )
              })
            )
            .pipe(Effect.catchTag("SqlError", Effect.die))
          yield* syncFrontmatter(
            orgSlug,
            slug,
            indexRow.name,
            indexRow.icon,
            indexRow.color,
            indexRow.createdBy,
            indexRow.createdAt,
            makeProjectKey(indexRow.key),
            file.body,
            members,
            null,
            file.setup,
            file.banner ?? null
          )
          return {
            org: orgSlug,
            slug: indexRow.slug,
            key: makeProjectKey(indexRow.key),
            name: indexRow.name,
            icon: makeProjectIcon(indexRow.icon),
            color: makeProjectColor(indexRow.color),
            createdBy: indexRow.createdBy,
            createdAt: indexRow.createdAt,
            github: null,
            banner: file.banner ?? null,
            setup: file.setup,
            body: file.body,
            members,
            pendingMembers
          }
        }).pipe((effect) => withProjectWriteLock(slug, effect))
      )

    return {
      list,
      listPaged,
      listMembersPaged,
      create,
      get,
      getKey,
      getGithubIntegration,
      update,
      updateSetup,
      remove,
      requireMember,
      requireRole,
      addMember,
      updateMember,
      transferOwnership,
      removeMember,
      cancelPendingMember,
      unassignUserFromActiveTickets,
      connectGithub,
      disconnectGithub
    } satisfies ProjectsShape
  })
)

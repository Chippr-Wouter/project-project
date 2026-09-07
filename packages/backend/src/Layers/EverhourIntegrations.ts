import * as DateTime from "effect/DateTime"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { and, desc, eq, inArray } from "drizzle-orm"
import { randomBytes } from "node:crypto"
import {
  DEFAULT_WORK_TYPES,
  EverhourApiKeyMissing,
  EverhourConfigMissing,
  EverhourError,
  Forbidden,
  NotFound,
  type EverhourProjectIntegrationStatus,
  type OrgEverhourConfig,
  type PersonalEverhour
} from "@projectproject/shared"
import {
  everhourSectionLink,
  everhourWorkTypeTaskLink,
  organizationIntegration,
  projectEverhourIntegration,
  projectIntegrationLink,
  userEverhourIntegration
} from "../db/schema"
import { Db } from "../Services/Db"
import { Everhour } from "../Services/Everhour"
import type {
  EverhourClientError,
  EverhourTaskPayload
} from "../Services/Everhour"
import {
  EverhourIntegrations,
  type EverhourIntegrationsShape
} from "../Services/EverhourIntegrations"
import { GroupDocs } from "../Services/GroupDocs"
import { SecretCrypto } from "../Services/SecretCrypto"
import { TicketIndex } from "../Services/TicketIndex"

type MutableSummary = {
  sectionsCreated: number
  sectionsUpdated: number
  sectionsArchived: number
  tasksCreated: number
  tasksUpdated: number
  tasksClosed: number
  tasksRecreated: number
  tasksSkipped: number
  errors: Array<string>
}

type ActiveLink = {
  readonly linkId: string
  readonly projectId: string
  readonly organizationId: string
  readonly linkStatus: "active" | "disconnected" | "broken"
  readonly status: "active" | "disconnected" | "broken"
  readonly everhourProjectId: string
  readonly everhourProjectName: string
  readonly backlogSectionId: string | null
  readonly lastSyncedAt: Date | null
  readonly lastSyncStatus: "ok" | "error" | null
  readonly lastSyncError: string | null
}

const emptySummary = (): MutableSummary => ({
  sectionsCreated: 0,
  sectionsUpdated: 0,
  sectionsArchived: 0,
  tasksCreated: 0,
  tasksUpdated: 0,
  tasksClosed: 0,
  tasksRecreated: 0,
  tasksSkipped: 0,
  errors: []
})

const publicBaseUrl = Effect.sync(
  () => process.env.BETTER_AUTH_URL ?? "http://localhost:5173"
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const errorTag = (error: unknown) =>
  isRecord(error) && typeof error._tag === "string" ? error._tag : "Unknown"

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (isRecord(error)) {
    if (typeof error.message === "string") return error.message
    if (typeof error._tag === "string") return error._tag
  }
  return String(error)
}

export const workTypeTaskName = (sprintName: string, workTypeLabel: string) =>
  `${sprintName} — ${workTypeLabel}`

export interface DesiredWorkTypeTask {
  readonly groupId: string
  readonly workTypeKey: string
  readonly everhourSectionId: string
  readonly name: string
  readonly status: "open" | "closed"
}

export const planWorkTypeTasks = (
  sections: ReadonlyArray<{
    readonly groupId: string | null
    readonly name: string
    readonly everhourSectionId: string
    readonly status: "active" | "archived" | "broken"
  }>,
  config: OrgEverhourConfig
): ReadonlyArray<DesiredWorkTypeTask> => {
  const plan: Array<DesiredWorkTypeTask> = []
  for (const section of sections) {
    if (section.groupId === null) continue
    const closed = section.status === "archived"
    for (const workType of config.workTypes) {
      plan.push({
        groupId: section.groupId,
        workTypeKey: workType.key,
        everhourSectionId: section.everhourSectionId,
        name: workTypeTaskName(section.name, workType.label),
        status: closed ? "closed" : "open"
      })
    }
  }
  return plan
}

export const workTypeTaskAction = (
  row: { readonly name: string; readonly status: string } | undefined,
  desired: DesiredWorkTypeTask
): "create" | "update" | "noop" => {
  if (!row) return "create"
  const closed = desired.status === "closed"
  if (
    row.name !== desired.name ||
    (closed && row.status !== "archived") ||
    (!closed && row.status === "archived")
  ) {
    return "update"
  }
  return "noop"
}

const toStatus = (row: ActiveLink | null): EverhourProjectIntegrationStatus =>
  row === null
    ? {
        status: "not_connected",
        everhourProjectId: null,
        everhourProjectName: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        needsSync: false
      }
    : {
        status: row.status === "active" ? "active" : "broken",
        everhourProjectId: row.everhourProjectId,
        everhourProjectName: row.everhourProjectName,
        lastSyncedAt: row.lastSyncedAt,
        lastSyncStatus: row.lastSyncStatus,
        lastSyncError: row.lastSyncError,
        needsSync: row.status !== "active" || row.lastSyncStatus === "error"
      }

export const EverhourIntegrationsLive = Layer.effect(
  EverhourIntegrations,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const everhour = yield* Everhour
    const ticketIndex = yield* TicketIndex
    const groupDocs = yield* GroupDocs
    const secrets = yield* SecretCrypto

    const getProfile = (userId: string): Effect.Effect<PersonalEverhour> =>
      db.query.userEverhourIntegration
        .findFirst({
          columns: {
            everhourUserId: true,
            name: true,
            email: true,
            lastVerifiedAt: true,
            lastCheckError: true
          },
          where: {
            RAW: (table, _operators) => _operators.eq(table.userId, userId)!
          }
        })
        .pipe(
          Effect.orDie,
          Effect.map((row) => ({
            connected: row !== undefined,
            everhourUserId: row?.everhourUserId ?? null,
            name: row?.name ?? null,
            email: row?.email ?? null,
            lastVerifiedAt: row?.lastVerifiedAt ?? null,
            lastCheckError: row?.lastCheckError ?? null
          }))
        )

    const actorApiKey = (userId: string) =>
      Effect.gen(function* () {
        const row = yield* db.query.userEverhourIntegration
          .findFirst({
            columns: {
              encryptedApiKey: true,
              apiKeyNonce: true,
              apiKeyTag: true,
              everhourUserId: true
            },
            where: {
              RAW: (table, _operators) => _operators.eq(table.userId, userId)!
            }
          })
          .pipe(Effect.orDie)
        if (!row) return yield* new EverhourApiKeyMissing()
        const apiKey = yield* secrets
          .open({
            ciphertext: row.encryptedApiKey,
            nonce: row.apiKeyNonce,
            tag: row.apiKeyTag
          })
          .pipe(Effect.mapError(() => new EverhourConfigMissing()))
        return { apiKey, everhourUserId: row.everhourUserId }
      })

    const connectProfile = (userId: string, apiKey: string) =>
      Effect.gen(function* () {
        const verified = yield* everhour.getCurrentUser(apiKey)
        const sealed = yield* secrets
          .seal(apiKey)
          .pipe(Effect.mapError(() => new EverhourConfigMissing()))
        const encrypted = {
          encryptedApiKey: sealed.ciphertext,
          apiKeyNonce: sealed.nonce,
          apiKeyTag: sealed.tag
        }
        const now = yield* DateTime.nowAsDate
        yield* db
          .insert(userEverhourIntegration)
          .values({
            userId,
            ...encrypted,
            everhourUserId: verified.id,
            name: verified.name,
            email: verified.email,
            connectedAt: now,
            updatedAt: now,
            lastVerifiedAt: now,
            lastCheckStatus: "ok",
            lastCheckError: null
          })
          .onConflictDoUpdate({
            target: userEverhourIntegration.userId,
            set: {
              ...encrypted,
              everhourUserId: verified.id,
              name: verified.name,
              email: verified.email,
              updatedAt: now,
              lastVerifiedAt: now,
              lastCheckStatus: "ok",
              lastCheckError: null
            }
          })
          .pipe(Effect.orDie)
        return yield* getProfile(userId)
      })

    const disconnectProfile = (userId: string) =>
      db
        .delete(userEverhourIntegration)
        .where(eq(userEverhourIntegration.userId, userId))
        .pipe(Effect.orDie, Effect.andThen(getProfile(userId)))

    const projectRow = (orgSlug: string, slug: string) =>
      ticketIndex.projectFor(orgSlug, slug).pipe(Effect.orDie)

    const indexById = (projectId: string) =>
      db.query.projectIndex
        .findFirst({
          where: {
            RAW: (table, _operators) => _operators.eq(table.id, projectId)!
          }
        })
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row ? Effect.succeed(row) : Effect.fail(new NotFound())
          )
        )

    const requireMember = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        const project = yield* projectRow(orgSlug, slug)
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
        if (explicit) return explicit.role
        const orgRole = yield* db.query.member
          .findFirst({
            columns: { role: true },
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.organizationId, project.organizationId),
                  _operators.eq(table.userId, userId)
                )!
            }
          })
          .pipe(Effect.orDie)
        if (orgRole?.role === "owner" || orgRole?.role === "admin") {
          return "admin" as const
        }
        return yield* new NotFound()
      })

    const requireAdmin = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        const role = yield* requireMember(orgSlug, userId, slug)
        if (role !== "owner" && role !== "admin") {
          return yield* new Forbidden()
        }
      })

    const activeLink = (projectId: string) =>
      db
        .select({
          linkId: projectIntegrationLink.id,
          projectId: projectIntegrationLink.projectId,
          organizationId: projectIntegrationLink.organizationId,
          linkStatus: projectIntegrationLink.status,
          status: projectEverhourIntegration.status,
          everhourProjectId: projectEverhourIntegration.everhourProjectId,
          everhourProjectName: projectEverhourIntegration.everhourProjectName,
          backlogSectionId: projectEverhourIntegration.backlogSectionId,
          lastSyncedAt: projectEverhourIntegration.lastSyncedAt,
          lastSyncStatus: projectEverhourIntegration.lastSyncStatus,
          lastSyncError: projectEverhourIntegration.lastSyncError
        })
        .from(projectIntegrationLink)
        .innerJoin(
          projectEverhourIntegration,
          eq(
            projectEverhourIntegration.projectIntegrationLinkId,
            projectIntegrationLink.id
          )
        )
        .where(
          and(
            eq(projectIntegrationLink.projectId, projectId),
            eq(projectIntegrationLink.provider, "everhour"),
            inArray(projectIntegrationLink.status, ["active", "broken"])
          )
        )
        .orderBy(
          projectIntegrationLink.status,
          desc(projectIntegrationLink.updatedAt)
        )
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0] ?? null)
        )

    const getProjectStatus = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        yield* requireMember(orgSlug, userId, slug)
        const project = yield* projectRow(orgSlug, slug)
        const row = yield* activeLink(project.projectId)
        return toStatus(row)
      })

    const recordProjectSync = (
      linkId: string,
      status: "active" | "broken",
      actorUserId: string,
      syncStatus: "ok" | "error",
      error: string | null
    ) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        yield* db
          .update(projectIntegrationLink)
          .set({
            status,
            lastCheckStatus: syncStatus,
            lastCheckError: error,
            updatedAt: now
          })
          .where(eq(projectIntegrationLink.id, linkId))
          .pipe(Effect.orDie)
        yield* db
          .update(projectEverhourIntegration)
          .set({
            status,
            lastSyncedAt: now,
            lastSyncStatus: syncStatus,
            lastSyncError: error,
            lastSyncActorUserId: actorUserId
          })
          .where(
            eq(projectEverhourIntegration.projectIntegrationLinkId, linkId)
          )
          .pipe(Effect.orDie)
      })

    const mutate = <A>(effect: Effect.Effect<A, EverhourClientError>) =>
      Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(600))
        return yield* effect.pipe(
          Effect.catchTag("EverhourRateLimited", (error) =>
            Effect.sleep(Duration.seconds(error.retryAfterSeconds)).pipe(
              Effect.andThen(effect)
            )
          )
        )
      })

    const createOrReuseProjectLink = (
      orgSlug: string,
      userId: string,
      slug: string,
      actor: { readonly apiKey: string; readonly everhourUserId: string }
    ) =>
      Effect.gen(function* () {
        const project = yield* projectRow(orgSlug, slug)
        const existing = yield* activeLink(project.projectId)
        if (existing?.status === "active") {
          const remote = yield* everhour
            .getProject(actor.apiKey, existing.everhourProjectId)
            .pipe(Effect.result)
          if (remote._tag === "Success") return existing
          yield* Effect.logWarning(
            "Everhour existing project is unavailable; creating replacement"
          ).pipe(
            Effect.annotateLogs({
              orgSlug,
              slug,
              userId,
              everhourProjectId: existing.everhourProjectId,
              errorTag: errorTag(remote.failure),
              error: formatError(remote.failure)
            })
          )
          yield* recordProjectSync(
            existing.linkId,
            "broken",
            userId,
            "error",
            formatError(remote.failure)
          )
        }
        const index = yield* indexById(project.projectId)
        const remote = yield* mutate(
          everhour.createProject(actor.apiKey, {
            name: index.name,
            type: "board",
            users: [actor.everhourUserId]
          })
        )
        const now = yield* DateTime.nowAsDate
        const row = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const orgIntegration = yield* db.query.organizationIntegration
                .findFirst({
                  where: {
                    RAW: (table, _operators) =>
                      _operators.and(
                        _operators.eq(
                          table.organizationId,
                          project.organizationId
                        ),
                        _operators.eq(table.provider, "everhour"),
                        _operators.inArray(table.status, ["active", "broken"])
                      )!
                  }
                })
                .pipe(Effect.orDie)
              const activeOrgIntegration =
                orgIntegration ??
                (yield* db
                  .insert(organizationIntegration)
                  .values({
                    organizationId: project.organizationId,
                    provider: "everhour",
                    status: "active",
                    config: { workTypes: DEFAULT_WORK_TYPES },
                    lastCheckedAt: now,
                    lastCheckStatus: "ok"
                  })
                  .returning()
                  .pipe(
                    Effect.orDie,
                    Effect.map(([created]) => created)
                  ))
              if (orgIntegration) {
                yield* db
                  .update(organizationIntegration)
                  .set({
                    status: "active",
                    config: orgIntegration.config ?? {
                      workTypes: DEFAULT_WORK_TYPES
                    },
                    lastCheckedAt: now,
                    lastCheckStatus: "ok",
                    lastCheckError: null,
                    updatedAt: now
                  })
                  .where(eq(organizationIntegration.id, orgIntegration.id))
                  .pipe(Effect.orDie)
              }
              const [link] = yield* db
                .insert(projectIntegrationLink)
                .values({
                  projectId: project.projectId,
                  organizationId: project.organizationId,
                  organizationIntegrationId: activeOrgIntegration.id,
                  provider: "everhour",
                  status: "active",
                  lastCheckedAt: now,
                  lastCheckStatus: "ok"
                })
                .returning()
                .pipe(Effect.orDie)
              yield* db
                .insert(projectEverhourIntegration)
                .values({
                  projectIntegrationLinkId: link.id,
                  organizationId: project.organizationId,
                  status: "active",
                  everhourProjectId: remote.id,
                  everhourProjectName: remote.name,
                  lastSyncedAt: null,
                  lastSyncStatus: null
                })
                .pipe(Effect.orDie)
              return yield* activeLink(project.projectId).pipe(
                Effect.flatMap((row) =>
                  row ? Effect.succeed(row) : Effect.fail(new NotFound())
                )
              )
            })
          )
          .pipe(
            Effect.catchTag("SqlError", (error) =>
              Effect.logError("Everhour local link persistence failed").pipe(
                Effect.annotateLogs({
                  orgSlug,
                  slug,
                  userId,
                  everhourProjectId: remote.id,
                  error: formatError(error)
                }),
                Effect.andThen(
                  Effect.fail(
                    new EverhourError({
                      message:
                        "ProjectProject could not store the Everhour link"
                    })
                  )
                )
              )
            )
          )
        return row
      })

    const syncSections = (
      apiKey: string,
      link: ActiveLink,
      summary: MutableSummary,
      orgSlug: string,
      slug: string
    ) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        const ids = yield* groupDocs.listIds(orgSlug, slug).pipe(Effect.orDie)
        const groups = yield* Effect.forEach(ids, (id) =>
          groupDocs.read(orgSlug, slug, id).pipe(
            Effect.catchTag("NotFound", () => Effect.succeed(null)),
            Effect.orDie
          )
        )
        const sprintSections = groups
          .filter(
            (group): group is NonNullable<(typeof groups)[number]> =>
              group !== null && group.kind === "sprint"
          )
          .map((group) => ({
            localKey: `sprint:${group.id}`,
            groupId: group.id,
            name: group.name,
            status:
              group.completedAt === null
                ? ("open" as const)
                : ("archived" as const)
          }))
        const desired = sprintSections
        const existing = yield* db.query.everhourSectionLink
          .findMany({
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectIntegrationLinkId, link.linkId)!
            }
          })
          .pipe(Effect.orDie)
        const existingByKey = new Map(
          existing.map((row) => [row.localKey, row])
        )
        for (const section of desired) {
          const row = existingByKey.get(section.localKey)
          if (!row) {
            const created = yield* mutate(
              everhour.createSection(apiKey, link.everhourProjectId, section)
            )
            yield* db
              .insert(everhourSectionLink)
              .values({
                projectIntegrationLinkId: link.linkId,
                localKey: section.localKey,
                groupId: section.groupId,
                everhourSectionId: created.id,
                name: created.name,
                status: created.status === "archived" ? "archived" : "active",
                lastSyncedAt: now
              })
              .pipe(Effect.orDie)
            summary.sectionsCreated++
          } else if (
            row.name !== section.name ||
            row.status !== section.status
          ) {
            const updated = yield* mutate(
              everhour.updateSection(apiKey, row.everhourSectionId, section)
            )
            yield* db
              .update(everhourSectionLink)
              .set({
                name: updated.name,
                status: updated.status === "archived" ? "archived" : "active",
                lastSyncedAt: now
              })
              .where(
                and(
                  eq(everhourSectionLink.projectIntegrationLinkId, link.linkId),
                  eq(everhourSectionLink.localKey, section.localKey)
                )
              )
              .pipe(Effect.orDie)
            summary.sectionsUpdated++
          }
        }
        const desiredKeys = new Set(desired.map((section) => section.localKey))
        for (const row of existing) {
          if (desiredKeys.has(row.localKey) || row.status === "archived") {
            continue
          }
          yield* mutate(
            everhour.updateSection(apiKey, row.everhourSectionId, {
              name: row.name,
              status: "archived"
            })
          )
          yield* db
            .update(everhourSectionLink)
            .set({ status: "archived", lastSyncedAt: now })
            .where(
              and(
                eq(everhourSectionLink.projectIntegrationLinkId, link.linkId),
                eq(everhourSectionLink.localKey, row.localKey)
              )
            )
            .pipe(Effect.orDie)
          summary.sectionsArchived++
        }
      })

    const syncWorkTypeTasks = (
      apiKey: string,
      link: ActiveLink,
      summary: MutableSummary,
      config: OrgEverhourConfig
    ) =>
      // FIXME: when the org-settings work-type editor lands, propagate set edits to open sprints (rename→rename, add→create, remove→archive); completed sprints stay frozen.
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        const sections = yield* db.query.everhourSectionLink
          .findMany({
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectIntegrationLinkId, link.linkId)!
            }
          })
          .pipe(Effect.orDie)
        const existing = yield* db.query.everhourWorkTypeTaskLink
          .findMany({
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectIntegrationLinkId, link.linkId)!
            }
          })
          .pipe(Effect.orDie)
        const byKey = new Map(
          existing.map((row) => [`${row.groupId}:${row.workTypeKey}`, row])
        )
        for (const desired of planWorkTypeTasks(sections, config)) {
          const row = byKey.get(`${desired.groupId}:${desired.workTypeKey}`)
          const action = workTypeTaskAction(row, desired)
          if (action === "noop") continue
          const closed = desired.status === "closed"
          const payload = {
            name: desired.name,
            section: desired.everhourSectionId,
            labels: [],
            description: "",
            status: desired.status
          } satisfies EverhourTaskPayload
          if (action === "create") {
            const created = yield* mutate(
              everhour.createTask(apiKey, link.everhourProjectId, payload)
            )
            yield* db
              .insert(everhourWorkTypeTaskLink)
              .values({
                projectIntegrationLinkId: link.linkId,
                groupId: desired.groupId,
                workTypeKey: desired.workTypeKey,
                everhourTaskId: created.id,
                name: created.name,
                status: closed ? "archived" : "active",
                lastSyncedAt: now
              })
              .pipe(Effect.orDie)
            summary.tasksCreated++
            continue
          }
          yield* mutate(
            everhour.updateTask(apiKey, row!.everhourTaskId, payload)
          )
          yield* db
            .update(everhourWorkTypeTaskLink)
            .set({
              name: desired.name,
              status: closed ? "archived" : "active",
              lastSyncedAt: now
            })
            .where(
              and(
                eq(
                  everhourWorkTypeTaskLink.projectIntegrationLinkId,
                  link.linkId
                ),
                eq(everhourWorkTypeTaskLink.groupId, desired.groupId),
                eq(everhourWorkTypeTaskLink.workTypeKey, desired.workTypeKey)
              )
            )
            .pipe(Effect.orDie)
          if (closed) summary.tasksClosed++
          else summary.tasksUpdated++
        }
      })

    const runFullSync = (
      orgSlug: string,
      userId: string,
      slug: string,
      createIfMissing: boolean
    ) =>
      Effect.gen(function* () {
        yield* requireAdmin(orgSlug, userId, slug)
        const actor = yield* actorApiKey(userId)
        const { apiKey } = actor
        const project = yield* projectRow(orgSlug, slug)
        const link = createIfMissing
          ? yield* createOrReuseProjectLink(orgSlug, userId, slug, actor)
          : yield* activeLink(project.projectId).pipe(
              Effect.flatMap((row) =>
                row ? Effect.succeed(row) : Effect.fail(new NotFound())
              )
            )
        const index = yield* indexById(project.projectId)
        const summary = emptySummary()
        yield* everhour
          .getProject(apiKey, link.everhourProjectId)
          .pipe(
            Effect.catch((error) =>
              recordProjectSync(
                link.linkId,
                "broken",
                userId,
                "error",
                formatError(error)
              ).pipe(Effect.andThen(Effect.fail(error)))
            )
          )
        if (link.everhourProjectName !== index.name) {
          yield* mutate(
            everhour.updateProject(apiKey, link.everhourProjectId, {
              name: index.name
            })
          )
          yield* db
            .update(projectEverhourIntegration)
            .set({ everhourProjectName: index.name })
            .where(
              eq(
                projectEverhourIntegration.projectIntegrationLinkId,
                link.linkId
              )
            )
            .pipe(Effect.orDie)
        }
        yield* syncSections(apiKey, link, summary, orgSlug, slug)
        const orgIntegration = yield* db.query.organizationIntegration
          .findFirst({
            columns: { config: true },
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.organizationId, link.organizationId),
                  _operators.eq(table.provider, "everhour"),
                  _operators.inArray(table.status, ["active", "broken"])
                )!
            }
          })
          .pipe(Effect.orDie)
        const config = (orgIntegration?.config as OrgEverhourConfig | null) ?? {
          workTypes: DEFAULT_WORK_TYPES
        }
        yield* syncWorkTypeTasks(apiKey, link, summary, config)
        yield* recordProjectSync(link.linkId, "active", userId, "ok", null)
        return summary
      }).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Everhour project sync failed").pipe(
            Effect.annotateLogs({
              orgSlug,
              slug,
              userId,
              createIfMissing,
              errorTag: errorTag(error),
              error: formatError(error)
            })
          )
        ),
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const project = yield* projectRow(orgSlug, slug)
            const link = yield* activeLink(project.projectId)
            if (!link) return
            yield* recordProjectSync(
              link.linkId,
              link.status === "broken" ? "broken" : "active",
              userId,
              "error",
              formatError(error)
            )
          })
        )
      )

    const ensureWebhook = (
      orgSlug: string,
      slug: string,
      apiKey: string,
      everhourProjectId: string,
      linkId: string
    ) =>
      Effect.gen(function* () {
        const row = yield* db.query.projectEverhourIntegration
          .findFirst({
            columns: { webhookId: true },
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectIntegrationLinkId, linkId)!
            }
          })
          .pipe(Effect.orDie)
        if (row?.webhookId) return
        const base = yield* publicBaseUrl
        const secret = randomBytes(24).toString("base64url")
        const created = yield* everhour.createWebhook(apiKey, {
          targetUrl: `${base}/api/integrations/everhour/webhook/${secret}`,
          project: everhourProjectId
        })
        yield* db
          .update(projectEverhourIntegration)
          .set({ webhookId: created.id, webhookSecret: secret })
          .where(
            eq(projectEverhourIntegration.projectIntegrationLinkId, linkId)
          )
          .pipe(Effect.orDie)
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Everhour webhook registration failed").pipe(
            Effect.annotateLogs({
              orgSlug,
              slug,
              errorTag: errorTag(error),
              error: formatError(error)
            }),
            Effect.asVoid
          )
        )
      )

    const deleteWebhookBestEffort = (
      apiKey: string,
      linkId: string,
      webhookId: string
    ) =>
      everhour.deleteWebhook(apiKey, webhookId).pipe(
        Effect.andThen(
          db
            .update(projectEverhourIntegration)
            .set({ webhookId: null, webhookSecret: null })
            .where(
              eq(projectEverhourIntegration.projectIntegrationLinkId, linkId)
            )
            .pipe(Effect.orDie)
        ),
        Effect.catch(() => Effect.void)
      )

    const disconnectProject = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(orgSlug, userId, slug)
        const project = yield* projectRow(orgSlug, slug)
        const link = yield* activeLink(project.projectId)
        if (link) {
          const now = yield* DateTime.nowAsDate
          const integration = yield* db.query.projectEverhourIntegration
            .findFirst({
              columns: { webhookId: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.eq(table.projectIntegrationLinkId, link.linkId)!
              }
            })
            .pipe(Effect.orDie)
          if (integration?.webhookId) {
            yield* actorApiKey(userId).pipe(
              Effect.flatMap((actor) =>
                deleteWebhookBestEffort(
                  actor.apiKey,
                  link.linkId,
                  integration.webhookId!
                )
              ),
              Effect.catch(() => Effect.void)
            )
          }
          yield* db
            .update(projectIntegrationLink)
            .set({
              status: "disconnected",
              disconnectedAt: now,
              updatedAt: now
            })
            .where(eq(projectIntegrationLink.id, link.linkId))
            .pipe(Effect.orDie)
          yield* db
            .update(projectEverhourIntegration)
            .set({ status: "disconnected" })
            .where(
              eq(
                projectEverhourIntegration.projectIntegrationLinkId,
                link.linkId
              )
            )
            .pipe(Effect.orDie)
        }
        return yield* getProjectStatus(orgSlug, userId, slug)
      })

    const bestEffortProjectSync = (
      orgSlug: string,
      userId: string,
      slug: string
    ) =>
      runFullSync(orgSlug, userId, slug, false).pipe(
        Effect.timeout(Duration.seconds(5)),
        Effect.catch((error) =>
          Effect.logWarning("Everhour best-effort sync failed").pipe(
            Effect.annotateLogs({
              orgSlug,
              slug,
              userId,
              errorTag: errorTag(error),
              error: formatError(error)
            }),
            Effect.asVoid
          )
        )
      )

    const connectProject = (orgSlug: string, userId: string, slug: string) =>
      runFullSync(orgSlug, userId, slug, true).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            const project = yield* projectRow(orgSlug, slug)
            const link = yield* activeLink(project.projectId)
            if (!link) return yield* error
            yield* Effect.logWarning(
              "Everhour project connected with incomplete initial sync"
            ).pipe(
              Effect.annotateLogs({
                orgSlug,
                slug,
                userId,
                everhourProjectId: link.everhourProjectId,
                errorTag: errorTag(error),
                error: formatError(error)
              })
            )
            return {
              ...emptySummary(),
              errors: [formatError(error)]
            }
          })
        ),
        Effect.tap(() =>
          actorApiKey(userId).pipe(
            Effect.flatMap((actor) =>
              Effect.gen(function* () {
                const project = yield* projectRow(orgSlug, slug)
                const link = yield* activeLink(project.projectId)
                if (!link) return
                yield* ensureWebhook(
                  orgSlug,
                  slug,
                  actor.apiKey,
                  link.everhourProjectId,
                  link.linkId
                )
              })
            ),
            Effect.catch(() => Effect.void)
          )
        )
      )

    return {
      getProfile,
      connectProfile,
      disconnectProfile,
      getProjectStatus,
      connectProject,
      syncProject: (orgSlug, userId, slug) =>
        runFullSync(orgSlug, userId, slug, false),
      disconnectProject,
      bestEffortProjectSync
    } satisfies EverhourIntegrationsShape
  })
)

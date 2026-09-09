import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { and, desc, eq, inArray } from "drizzle-orm"
import {
  DEFAULT_WORK_TYPES,
  EverhourApiKeyMissing,
  EverhourConfigMissing,
  NotFound,
  type ActiveTimer,
  type OrgEverhourConfig,
  type TicketTimeSummary,
  type WorkTypeOption
} from "@projectproject/shared"
import {
  everhourActiveTimer,
  everhourTimeAttribution,
  projectEverhourIntegration,
  projectIntegrationLink
} from "../db/schema"
import { Db } from "../Services/Db"
import { Everhour, type EverhourTimeRecord } from "../Services/Everhour"
import {
  EverhourTimeTracking,
  type EverhourTimeTrackingShape
} from "../Services/EverhourTimeTracking"
import { GroupDocs } from "../Services/GroupDocs"
import { SecretCrypto } from "../Services/SecretCrypto"
import { TicketDocs } from "../Services/TicketDocs"
import { TicketIndex } from "../Services/TicketIndex"

export const timerComment = (
  ticketId: string | null,
  ticketTitle: string | null,
  note?: string
): string => {
  const trimmedNote = note?.trim()
  const head = ticketId
    ? ticketTitle
      ? `${ticketId} — ${ticketTitle}`
      : ticketId
    : null
  return [head, trimmedNote ? trimmedNote : null]
    .filter((part): part is string => part !== null)
    .join(" — ")
}

export const summariseAttribution = (
  rows: ReadonlyArray<{
    readonly everhourUserId: string
    readonly seconds: number
  }>,
  everhourUserId: string | null
): { totalSeconds: number; userSeconds: number } => {
  let totalSeconds = 0
  let userSeconds = 0
  for (const row of rows) {
    totalSeconds += row.seconds
    if (everhourUserId !== null && row.everhourUserId === everhourUserId) {
      userSeconds += row.seconds
    }
  }
  return { totalSeconds, userSeconds }
}

export const resolveSprintForTicket = (
  sprints: ReadonlyArray<{
    readonly id: string
    readonly tickets: ReadonlyArray<string>
  }>,
  ticketId: string
): string | null =>
  sprints.find((sprint) => sprint.tickets.includes(ticketId))?.id ?? null

export const workTypeOptions = (
  config: OrgEverhourConfig
): ReadonlyArray<WorkTypeOption> =>
  [...config.workTypes]
    .sort((a, b) => a.order - b.order)
    .map((workType) => ({ key: workType.key, label: workType.label }))

export const EverhourTimeTrackingLive = Layer.effect(
  EverhourTimeTracking,
  Effect.gen(function* () {
    const db = yield* Db
    const everhour = yield* Everhour
    const groupDocs = yield* GroupDocs
    const ticketDocs = yield* TicketDocs
    const ticketIndex = yield* TicketIndex
    const secrets = yield* SecretCrypto

    const projectRow = (orgSlug: string, slug: string) =>
      ticketIndex.projectFor(orgSlug, slug)

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
        if (explicit) return project
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
          return project
        }
        return yield* new NotFound()
      })

    const activeLink = (projectId: string) =>
      db
        .select({
          linkId: projectIntegrationLink.id,
          organizationId: projectIntegrationLink.organizationId,
          everhourProjectId: projectEverhourIntegration.everhourProjectId
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

    const loadConfig = (organizationId: string) =>
      db.query.organizationIntegration
        .findFirst({
          columns: { config: true },
          where: {
            RAW: (table, _operators) =>
              _operators.and(
                _operators.eq(table.organizationId, organizationId),
                _operators.eq(table.provider, "everhour"),
                _operators.inArray(table.status, ["active", "broken"])
              )!
          }
        })
        .pipe(
          Effect.orDie,
          Effect.map(
            (row): OrgEverhourConfig =>
              (row?.config as OrgEverhourConfig | null) ?? {
                workTypes: DEFAULT_WORK_TYPES
              }
          )
        )

    const loadSprints = (orgSlug: string, slug: string) =>
      Effect.gen(function* () {
        const ids = yield* groupDocs.listIds(orgSlug, slug).pipe(Effect.orDie)
        const groups = yield* Effect.forEach(
          ids,
          (id) =>
            groupDocs.read(orgSlug, slug, id).pipe(
              Effect.catchTag("NotFound", () => Effect.succeed(null)),
              Effect.orDie
            ),
          { concurrency: 8 }
        )
        return groups
          .filter(
            (group): group is NonNullable<(typeof groups)[number]> =>
              group !== null && group.kind === "sprint"
          )
          .map((group) => ({
            id: group.id,
            name: group.name,
            tickets: group.tickets as ReadonlyArray<string>
          }))
      })

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

    const everhourUserIdFor = (userId: string) =>
      db.query.userEverhourIntegration
        .findFirst({
          columns: { everhourUserId: true },
          where: {
            RAW: (table, _operators) => _operators.eq(table.userId, userId)!
          }
        })
        .pipe(
          Effect.orDie,
          Effect.map((row) => row?.everhourUserId ?? null)
        )

    const resolveWorkTypeTask = (
      linkId: string,
      groupId: string,
      workTypeKey: string,
      config: OrgEverhourConfig
    ) =>
      Effect.gen(function* () {
        const row = yield* db.query.everhourWorkTypeTaskLink
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.projectIntegrationLinkId, linkId),
                  _operators.eq(table.groupId, groupId),
                  _operators.eq(table.workTypeKey, workTypeKey)
                )!
            }
          })
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFound()
        const label =
          config.workTypes.find((workType) => workType.key === workTypeKey)
            ?.label ?? workTypeKey
        return { everhourTaskId: row.everhourTaskId, workTypeLabel: label }
      })

    const ticketTitle = (orgSlug: string, slug: string, ticketId: string) =>
      ticketDocs.read(orgSlug, slug, ticketId).pipe(
        Effect.map((ticket) => ticket.title),
        Effect.catch(() => Effect.succeed<string | null>(null))
      )

    const writeAttribution = (
      record: EverhourTimeRecord,
      context: {
        readonly projectIntegrationLinkId: string
        readonly ticketId: string | null
        readonly groupId: string
        readonly workTypeKey: string
        readonly everhourUserId: string
        readonly userId: string
      },
      now: Date
    ) =>
      db
        .insert(everhourTimeAttribution)
        .values({
          everhourTimeId: record.id,
          projectIntegrationLinkId: context.projectIntegrationLinkId,
          ticketId: context.ticketId,
          groupId: context.groupId,
          workTypeKey: context.workTypeKey,
          everhourUserId: context.everhourUserId,
          userId: context.userId,
          seconds: record.seconds,
          date: record.date,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: everhourTimeAttribution.everhourTimeId,
          set: { seconds: record.seconds, date: record.date, updatedAt: now }
        })
        .pipe(Effect.orDie)

    const clearActiveTimer = (everhourUserId: string) =>
      db
        .delete(everhourActiveTimer)
        .where(eq(everhourActiveTimer.everhourUserId, everhourUserId))
        .pipe(Effect.orDie)

    const activeTimerRowFor = (everhourUserId: string) =>
      db.query.everhourActiveTimer
        .findFirst({
          where: {
            RAW: (table, _operators) =>
              _operators.eq(table.everhourUserId, everhourUserId)!
          }
        })
        .pipe(Effect.orDie)

    const hydrateActiveTimer = (
      orgSlug: string,
      row: typeof everhourActiveTimer.$inferSelect
    ) =>
      Effect.gen(function* () {
        const link = yield* db.query.projectIntegrationLink
          .findFirst({
            columns: { organizationId: true, projectId: true },
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.id, row.projectIntegrationLinkId)!
            }
          })
          .pipe(Effect.orDie)
        let workTypeLabel = row.workTypeKey
        let title: string | null = null
        let slug = ""
        if (link) {
          const config = yield* loadConfig(link.organizationId)
          workTypeLabel =
            config.workTypes.find(
              (workType) => workType.key === row.workTypeKey
            )?.label ?? row.workTypeKey
          const index = yield* db.query.projectIndex
            .findFirst({
              columns: { slug: true },
              where: {
                RAW: (table, _operators) =>
                  _operators.eq(table.id, link.projectId)!
              }
            })
            .pipe(Effect.orDie)
          if (index) {
            slug = index.slug
            if (row.ticketId) {
              title = yield* ticketTitle(orgSlug, index.slug, row.ticketId)
            }
          }
        }
        return {
          slug,
          ticketId: row.ticketId,
          ticketTitle: title,
          groupId: row.groupId,
          workTypeKey: row.workTypeKey,
          workTypeLabel,
          everhourTaskId: row.everhourTaskId,
          startedAt: row.startedAt
        } as ActiveTimer
      })

    const finalizeRunning = (apiKey: string, everhourUserId: string) =>
      Effect.gen(function* () {
        const row = yield* activeTimerRowFor(everhourUserId)
        if (!row) return
        const record = yield* everhour.stopTimer(apiKey)
        const now = yield* DateTime.nowAsDate
        if (record) {
          yield* writeAttribution(
            record,
            {
              projectIntegrationLinkId: row.projectIntegrationLinkId,
              ticketId: row.ticketId,
              groupId: row.groupId,
              workTypeKey: row.workTypeKey,
              everhourUserId,
              userId: row.userId
            },
            now
          )
        }
        yield* clearActiveTimer(everhourUserId)
      })

    const startTimer = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: string | null,
      groupId: string,
      workTypeKey: string,
      note: string | undefined
    ) =>
      Effect.gen(function* () {
        const project = yield* requireMember(orgSlug, userId, slug)
        const actor = yield* actorApiKey(userId)
        const link = yield* activeLink(project.projectId).pipe(
          Effect.flatMap((row) =>
            row ? Effect.succeed(row) : Effect.fail(new NotFound())
          )
        )
        const config = yield* loadConfig(link.organizationId)
        const task = yield* resolveWorkTypeTask(
          link.linkId,
          groupId,
          workTypeKey,
          config
        )
        const title = ticketId
          ? yield* ticketTitle(orgSlug, slug, ticketId)
          : null
        yield* finalizeRunning(actor.apiKey, actor.everhourUserId)
        const comment = timerComment(ticketId, title, note)
        const timer = yield* everhour.startTimer(actor.apiKey, {
          task: task.everhourTaskId,
          comment: comment.length > 0 ? comment : undefined
        })
        const now = yield* DateTime.nowAsDate
        yield* db
          .insert(everhourActiveTimer)
          .values({
            everhourUserId: actor.everhourUserId,
            userId,
            projectIntegrationLinkId: link.linkId,
            ticketId,
            groupId,
            workTypeKey,
            everhourTaskId: task.everhourTaskId,
            everhourTimerId: timer.id,
            startedAt: now
          })
          .onConflictDoUpdate({
            target: everhourActiveTimer.everhourUserId,
            set: {
              userId,
              projectIntegrationLinkId: link.linkId,
              ticketId,
              groupId,
              workTypeKey,
              everhourTaskId: task.everhourTaskId,
              everhourTimerId: timer.id,
              startedAt: now
            }
          })
          .pipe(Effect.orDie)
        return {
          slug,
          ticketId,
          ticketTitle: title,
          groupId,
          workTypeKey,
          workTypeLabel: task.workTypeLabel,
          everhourTaskId: task.everhourTaskId,
          startedAt: now
        } as ActiveTimer
      })

    const workTypesForTicket: EverhourTimeTrackingShape["workTypesForTicket"] =
      (orgSlug, userId, slug, ticketId) =>
        Effect.gen(function* () {
          const project = yield* requireMember(orgSlug, userId, slug)
          const link = yield* activeLink(project.projectId)
          if (!link) return []
          const sprints = yield* loadSprints(orgSlug, slug)
          const groupId = resolveSprintForTicket(sprints, ticketId)
          if (groupId === null) return []
          const config = yield* loadConfig(link.organizationId)
          return workTypeOptions(config)
        })

    const startTicketTimer: EverhourTimeTrackingShape["startTicketTimer"] = (
      orgSlug,
      userId,
      slug,
      ticketId,
      input
    ) =>
      Effect.gen(function* () {
        const sprints = yield* loadSprints(orgSlug, slug)
        const groupId = resolveSprintForTicket(sprints, ticketId)
        if (groupId === null) return yield* new NotFound()
        return yield* startTimer(
          orgSlug,
          userId,
          slug,
          ticketId,
          groupId,
          input.workTypeKey,
          input.comment
        )
      })

    const startSprintTimer: EverhourTimeTrackingShape["startSprintTimer"] = (
      orgSlug,
      userId,
      slug,
      groupId,
      input
    ) =>
      startTimer(
        orgSlug,
        userId,
        slug,
        null,
        groupId,
        input.workTypeKey,
        input.comment
      )

    const stopTimer: EverhourTimeTrackingShape["stopTimer"] = (
      orgSlug,
      userId
    ) =>
      Effect.gen(function* () {
        const actor = yield* actorApiKey(userId)
        const row = yield* activeTimerRowFor(actor.everhourUserId)
        const record = yield* everhour.stopTimer(actor.apiKey)
        if (!row) return null
        const now = yield* DateTime.nowAsDate
        if (record) {
          yield* writeAttribution(
            record,
            {
              projectIntegrationLinkId: row.projectIntegrationLinkId,
              ticketId: row.ticketId,
              groupId: row.groupId,
              workTypeKey: row.workTypeKey,
              everhourUserId: actor.everhourUserId,
              userId: row.userId
            },
            now
          )
        }
        const hydrated = yield* hydrateActiveTimer(orgSlug, row)
        yield* clearActiveTimer(actor.everhourUserId)
        return hydrated
      })

    const currentTimer: EverhourTimeTrackingShape["currentTimer"] = (
      orgSlug,
      userId
    ) =>
      Effect.gen(function* () {
        const everhourUserId = yield* everhourUserIdFor(userId)
        if (everhourUserId === null) return null
        const row = yield* activeTimerRowFor(everhourUserId)
        if (!row) return null
        return yield* hydrateActiveTimer(orgSlug, row)
      })

    const logTime: EverhourTimeTrackingShape["logTime"] = (
      orgSlug,
      userId,
      slug,
      input
    ) =>
      Effect.gen(function* () {
        const project = yield* requireMember(orgSlug, userId, slug)
        const actor = yield* actorApiKey(userId)
        const link = yield* activeLink(project.projectId).pipe(
          Effect.flatMap((row) =>
            row ? Effect.succeed(row) : Effect.fail(new NotFound())
          )
        )
        const config = yield* loadConfig(link.organizationId)
        const ticketId = input.ticketId ?? null
        let groupId: string | null = input.groupId ?? null
        if (ticketId !== null) {
          const sprints = yield* loadSprints(orgSlug, slug)
          groupId = resolveSprintForTicket(sprints, ticketId)
        }
        if (groupId === null) return yield* new NotFound()
        const task = yield* resolveWorkTypeTask(
          link.linkId,
          groupId,
          input.workTypeKey,
          config
        )
        const title = ticketId
          ? yield* ticketTitle(orgSlug, slug, ticketId)
          : null
        const comment = timerComment(ticketId, title, input.comment)
        const record = yield* everhour.addTime(actor.apiKey, {
          task: task.everhourTaskId,
          time: input.seconds,
          date: input.date,
          comment: comment.length > 0 ? comment : undefined
        })
        const now = yield* DateTime.nowAsDate
        yield* writeAttribution(
          record,
          {
            projectIntegrationLinkId: link.linkId,
            ticketId,
            groupId,
            workTypeKey: input.workTypeKey,
            everhourUserId: actor.everhourUserId,
            userId
          },
          now
        )
        if (ticketId === null) return null
        return yield* ticketTimeSummary(orgSlug, userId, slug, ticketId)
      })

    const ticketTimeSummary: EverhourTimeTrackingShape["ticketTimeSummary"] = (
      orgSlug,
      userId,
      slug,
      ticketId
    ) =>
      Effect.gen(function* () {
        const project = yield* requireMember(orgSlug, userId, slug)
        const link = yield* activeLink(project.projectId)
        if (!link) {
          return {
            ticketId,
            totalSeconds: 0,
            userSeconds: 0
          } as TicketTimeSummary
        }
        const rows = yield* db.query.everhourTimeAttribution
          .findMany({
            columns: { everhourUserId: true, seconds: true },
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.projectIntegrationLinkId, link.linkId),
                  _operators.eq(table.ticketId, ticketId)
                )!
            }
          })
          .pipe(Effect.orDie)
        const everhourUserId = yield* everhourUserIdFor(userId)
        const { totalSeconds, userSeconds } = summariseAttribution(
          rows,
          everhourUserId
        )
        return { ticketId, totalSeconds, userSeconds } as TicketTimeSummary
      })

    const applyWebhookTimeEvent: EverhourTimeTrackingShape["applyWebhookTimeEvent"] =
      (_projectIntegrationLinkId, record) =>
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate
          const recordUserId = record.userId
          const recordTaskId = record.taskId
          const matched =
            recordUserId !== null && recordTaskId !== null
              ? yield* db.query.everhourActiveTimer
                  .findFirst({
                    where: {
                      RAW: (table, _operators) =>
                        _operators.and(
                          _operators.eq(table.everhourUserId, recordUserId),
                          _operators.eq(table.everhourTaskId, recordTaskId)
                        )!
                    }
                  })
                  .pipe(Effect.orDie)
              : undefined
          if (matched) {
            yield* writeAttribution(
              record,
              {
                projectIntegrationLinkId: matched.projectIntegrationLinkId,
                ticketId: matched.ticketId,
                groupId: matched.groupId,
                workTypeKey: matched.workTypeKey,
                everhourUserId: matched.everhourUserId,
                userId: matched.userId
              },
              now
            )
            yield* clearActiveTimer(matched.everhourUserId)
            return
          }
          const existing = yield* db.query.everhourTimeAttribution
            .findFirst({
              where: {
                RAW: (table, _operators) =>
                  _operators.eq(table.everhourTimeId, record.id)!
              }
            })
            .pipe(Effect.orDie)
          if (existing) {
            yield* db
              .update(everhourTimeAttribution)
              .set({
                seconds: record.seconds,
                date: record.date,
                updatedAt: now
              })
              .where(eq(everhourTimeAttribution.everhourTimeId, record.id))
              .pipe(Effect.orDie)
          }
        }).pipe(Effect.ignore)

    return {
      workTypesForTicket,
      startTicketTimer,
      startSprintTimer,
      stopTimer,
      currentTimer,
      logTime,
      ticketTimeSummary,
      applyWebhookTimeEvent
    } satisfies EverhourTimeTrackingShape
  })
)

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { and, eq } from "drizzle-orm"
import { generateKeyBetween } from "fractional-indexing"
import {
  Conflict,
  Forbidden,
  NotFound,
  ProjectStatus,
  StatusColor,
  StatusLabel,
  StatusSlug,
  deriveStatusSlug,
  isReservedStatusSlug,
  pickStatusColor
} from "@projectproject/shared"
import { Db } from "../Services/Db"
import { projectStatus } from "../db/schema"
import { Projects } from "../Services/Projects"
import {
  ProjectStatuses,
  type ProjectStatusesShape
} from "../Services/ProjectStatuses"
import { TicketIndex } from "../Services/TicketIndex"
import { Tickets } from "../Services/Tickets"

const makeSlug = Schema.decodeUnknownSync(StatusSlug)
const makeLabel = Schema.decodeUnknownSync(StatusLabel)
const makeColor = Schema.decodeUnknownSync(StatusColor)

const rowToStatus = (r: typeof projectStatus.$inferSelect): ProjectStatus => ({
  slug: makeSlug(r.slug),
  label: makeLabel(r.label),
  icon: r.icon as ProjectStatus["icon"],
  color: makeColor(r.color),
  orderKey: r.orderKey as ProjectStatus["orderKey"],
  createdBy: r.createdBy,
  createdAt: r.createdAt
})

export const ProjectStatusesLive = Layer.effect(
  ProjectStatuses,
  Effect.gen(function* () {
    const db = yield* Db
    const projects = yield* Projects
    const ticketIndex = yield* TicketIndex
    const tickets = yield* Tickets

    const projectIdFromSlug = (slug: string) =>
      db.query.projectIndex
        .findFirst({
          columns: { id: true },
          where: {
            RAW: (table, _operators) => _operators.eq(table.slug, slug)!
          }
        })
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row ? Effect.succeed(row.id) : Effect.fail(new NotFound())
          )
        )

    const list: ProjectStatusesShape["list"] = (orgSlug, userId, slug) =>
      Effect.gen(function* () {
        yield* projects.requireMember(orgSlug, userId, slug)
        const projectId = yield* projectIdFromSlug(slug)
        const rows = yield* db.query.projectStatus
          .findMany({
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectId, projectId)!
            },
            orderBy: (table, operators) => operators.asc(table.orderKey)
          })
          .pipe(Effect.orDie)
        return rows.map(rowToStatus)
      })

    const DEFAULT_ICON = "Circle"

    const rewriteTicketsStatus = (
      orgSlug: string,
      slug: string,
      ids: ReadonlyArray<string>,
      toSlug: string
    ) =>
      Effect.forEach(
        ids,
        (id) =>
          tickets.replaceStatus(orgSlug, slug, id, toSlug).pipe(
            Effect.catchTag("NotFound", () => Effect.succeed(false)),
            Effect.catchTag("MalformedTicketDocument", () =>
              Effect.succeed(false)
            )
          ),
        { concurrency: 8 }
      )

    const create: ProjectStatusesShape["create"] = (
      orgSlug,
      userId,
      slug,
      input
    ) =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        const projectId = yield* projectIdFromSlug(slug)

        const derived = deriveStatusSlug(input.label)
        if (derived.length === 0)
          return yield* new Conflict({ reason: "invalid_label" })
        if (isReservedStatusSlug(derived))
          return yield* new Conflict({ reason: "reserved_slug" })

        const existing = yield* db.query.projectStatus
          .findMany({
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.projectId, projectId)!
            },
            orderBy: (table, operators) => operators.asc(table.orderKey)
          })
          .pipe(Effect.orDie)

        if (existing.some((s) => s.slug === derived))
          return yield* new Conflict({ reason: "slug_exists" })

        const lastKey =
          existing.length > 0 ? existing[existing.length - 1].orderKey : null
        const nextKey = generateKeyBetween(lastKey, null)

        const color =
          input.color ?? pickStatusColor(existing.map((s) => s.color))
        const icon = input.icon ?? DEFAULT_ICON

        const inserted = yield* db
          .insert(projectStatus)
          .values({
            projectId,
            slug: derived,
            label: input.label,
            icon,
            color,
            orderKey: nextKey,
            createdBy: userId
          })
          .returning()
          .pipe(Effect.orDie)
        return rowToStatus(inserted[0])
      })

    const update: ProjectStatusesShape["update"] = (
      orgSlug,
      userId,
      slug,
      statusSlug,
      input
    ) =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        const projectId = yield* projectIdFromSlug(slug)

        const current = yield* db.query.projectStatus
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.projectId, projectId),
                  _operators.eq(table.slug, statusSlug)
                )!
            }
          })
          .pipe(Effect.orDie)
        if (!current) return yield* new NotFound()

        if (isReservedStatusSlug(statusSlug)) return yield* new Forbidden()

        const newLabel = input.label ?? current.label
        const newSlug = input.label
          ? deriveStatusSlug(input.label)
          : current.slug

        if (newSlug.length === 0)
          return yield* new Conflict({ reason: "invalid_label" })

        if (newSlug !== current.slug) {
          if (isReservedStatusSlug(newSlug))
            return yield* new Conflict({ reason: "reserved_slug" })
          const collision = yield* db.query.projectStatus
            .findFirst({
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectId, projectId),
                    _operators.eq(table.slug, newSlug)
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (collision) return yield* new Conflict({ reason: "slug_exists" })
        }

        const cosmetic = newSlug === current.slug

        if (cosmetic) {
          const updated = yield* db
            .update(projectStatus)
            .set({
              label: newLabel,
              icon: input.icon ?? current.icon,
              color: input.color ?? current.color
            })
            .where(
              and(
                eq(projectStatus.projectId, projectId),
                eq(projectStatus.slug, statusSlug)
              )
            )
            .returning()
            .pipe(Effect.orDie)
          return rowToStatus(updated[0])
        }

        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const affectedIds = yield* ticketIndex.findTicketIdsByStatus(
          indexProject,
          current.slug
        )
        yield* rewriteTicketsStatus(orgSlug, slug, affectedIds, newSlug)
        const updated = yield* db
          .update(projectStatus)
          .set({
            slug: newSlug,
            label: newLabel,
            icon: input.icon ?? current.icon,
            color: input.color ?? current.color
          })
          .where(
            and(
              eq(projectStatus.projectId, projectId),
              eq(projectStatus.slug, statusSlug)
            )
          )
          .returning()
          .pipe(Effect.orDie)
        return rowToStatus(updated[0])
      })

    const reorder: ProjectStatusesShape["reorder"] = (
      orgSlug,
      userId,
      slug,
      statusSlug,
      input
    ) =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        const projectId = yield* projectIdFromSlug(slug)
        const updated = yield* db
          .update(projectStatus)
          .set({ orderKey: input.orderKey })
          .where(
            and(
              eq(projectStatus.projectId, projectId),
              eq(projectStatus.slug, statusSlug)
            )
          )
          .returning()
          .pipe(Effect.orDie)
        if (updated.length === 0) return yield* new NotFound()
        return rowToStatus(updated[0])
      })

    const remove: ProjectStatusesShape["remove"] = (
      orgSlug,
      userId,
      slug,
      statusSlug,
      input
    ) =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        if (isReservedStatusSlug(statusSlug)) return yield* new Forbidden()
        const projectId = yield* projectIdFromSlug(slug)

        const current = yield* db.query.projectStatus
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.projectId, projectId),
                  _operators.eq(table.slug, statusSlug)
                )!
            }
          })
          .pipe(Effect.orDie)
        if (!current) return yield* new NotFound()

        const indexProject = yield* ticketIndex.projectFor(orgSlug, slug)
        const affectedIds = yield* ticketIndex.findTicketIdsByStatus(
          indexProject,
          statusSlug
        )
        if (affectedIds.length > 0) {
          if (!input.reassignTo)
            return yield* new Conflict({ reason: "reassign_required" })
          if (input.reassignTo === statusSlug)
            return yield* new Conflict({ reason: "reassign_target_invalid" })
          const reassignTo = input.reassignTo
          const target = yield* db.query.projectStatus
            .findFirst({
              where: {
                RAW: (table, _operators) =>
                  _operators.and(
                    _operators.eq(table.projectId, projectId),
                    _operators.eq(table.slug, reassignTo)
                  )!
              }
            })
            .pipe(Effect.orDie)
          if (!target)
            return yield* new Conflict({ reason: "reassign_target_missing" })

          yield* rewriteTicketsStatus(
            orgSlug,
            slug,
            affectedIds,
            input.reassignTo
          )
        }
        yield* db
          .delete(projectStatus)
          .where(
            and(
              eq(projectStatus.projectId, projectId),
              eq(projectStatus.slug, statusSlug)
            )
          )
          .pipe(Effect.orDie)
      })

    return {
      list,
      create,
      update,
      reorder,
      remove
    }
  })
)

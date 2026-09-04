import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { and, eq } from "drizzle-orm"
import {
  Conflict,
  Forbidden,
  NotFound,
  paginateSorted,
  Tag,
  TagColor,
  TagName,
  TAG_DEFAULT_PALETTE,
  type CreateTagInput,
  type CursorPayload,
  type UpdateTagInput
} from "@projectproject/shared"
import { projectIndex, projectTag } from "../db/schema"
import { Db } from "../Services/Db"
import type { MarkdownError } from "../Services/Markdown"
import { Projects } from "../Services/Projects"
import { Tags, type TagsShape } from "../Services/Tags"
import { TicketIndex } from "../Services/TicketIndex"
import { Tickets } from "../Services/Tickets"

const makeTagName = Schema.decodeUnknownSync(TagName)
const makeTagColor = Schema.decodeUnknownSync(TagColor)

function pickColor(used: ReadonlyArray<string>): TagColor {
  for (const c of TAG_DEFAULT_PALETTE)
    if (!used.includes(c)) return makeTagColor(c)
  return makeTagColor(
    TAG_DEFAULT_PALETTE[used.length % TAG_DEFAULT_PALETTE.length]
  )
}

export const TagsLive = Layer.effect(
  Tags,
  Effect.gen(function* () {
    const db = yield* Db
    const ticketIndex = yield* TicketIndex
    const projects = yield* Projects
    const tickets = yield* Tickets

    const projectIdFromSlug = (slug: string): Effect.Effect<string, NotFound> =>
      db.query.projectIndex
        .findFirst({
          columns: { id: true },
          where: eq(projectIndex.slug, slug)
        })
        .pipe(
          Effect.orDie,
          Effect.flatMap((row) =>
            row ? Effect.succeed(row.id) : Effect.fail(new NotFound())
          )
        )

    const rewriteTagInTickets = (
      orgSlug: string,
      slug: string,
      oldName: string,
      newName: string | null
    ): Effect.Effect<void, MarkdownError> =>
      Effect.gen(function* () {
        const project = yield* ticketIndex
          .projectFor(orgSlug, slug)
          .pipe(Effect.orDie)
        const ids = yield* ticketIndex.findTicketIdsByTag(project, oldName)
        for (const id of ids) {
          yield* tickets.replaceTag(orgSlug, slug, id, oldName, newName).pipe(
            Effect.catchTag("NotFound", () => Effect.succeed(false)),
            Effect.catchTag("MalformedTicketDocument", () =>
              Effect.succeed(false)
            )
          )
        }
      })

    const list = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<ReadonlyArray<Tag>, NotFound> =>
      Effect.gen(function* () {
        yield* projects.requireMember(orgSlug, userId, slug)
        const projectId = yield* projectIdFromSlug(slug)
        const rows = yield* db.query.projectTag
          .findMany({ where: eq(projectTag.projectId, projectId) })
          .pipe(Effect.orDie)
        return rows.map(
          (r): Tag => ({
            name: makeTagName(r.name),
            color: makeTagColor(r.color),
            createdBy: r.createdBy,
            createdAt: r.createdAt
          })
        )
      })

    const listPaged = (
      orgSlug: string,
      userId: string,
      slug: string,
      cursor: CursorPayload | undefined,
      limit: number
    ): Effect.Effect<
      { items: ReadonlyArray<Tag>; nextCursor: string | null },
      NotFound
    > =>
      Effect.gen(function* () {
        const all = yield* list(orgSlug, userId, slug)
        const sorted = [...all].toSorted((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0
        )
        return paginateSorted(sorted, {
          cursor,
          limit,
          sortKey: (t) => t.name,
          id: (t) => t.name
        })
      })

    const create = (
      orgSlug: string,
      userId: string,
      slug: string,
      input: CreateTagInput
    ): Effect.Effect<Tag, NotFound | Forbidden | Conflict> =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        const projectId = yield* projectIdFromSlug(slug)

        const existing = yield* db.query.projectTag
          .findMany({
            columns: { color: true },
            where: eq(projectTag.projectId, projectId)
          })
          .pipe(Effect.orDie)

        const color = input.color ?? pickColor(existing.map((e) => e.color))

        const existingRow = yield* db.query.projectTag
          .findFirst({
            columns: { name: true },
            where: and(
              eq(projectTag.projectId, projectId),
              eq(projectTag.name, input.name)
            )
          })
          .pipe(Effect.orDie)
        if (existingRow) return yield* new Conflict({ reason: "tag_exists" })

        const inserted = yield* db
          .insert(projectTag)
          .values({
            projectId,
            name: input.name,
            color,
            createdBy: userId
          })
          .returning()
          .pipe(Effect.orDie)
        const row = inserted[0]
        return {
          name: makeTagName(row.name),
          color: makeTagColor(row.color),
          createdBy: row.createdBy,
          createdAt: row.createdAt
        }
      })

    const update = (
      orgSlug: string,
      userId: string,
      slug: string,
      name: string,
      patch: UpdateTagInput
    ): Effect.Effect<Tag, NotFound | Forbidden | Conflict | MarkdownError> =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        const projectId = yield* projectIdFromSlug(slug)

        const existing = yield* db.query.projectTag
          .findFirst({
            where: and(
              eq(projectTag.projectId, projectId),
              eq(projectTag.name, name)
            )
          })
          .pipe(Effect.orDie)
        if (!existing) return yield* new NotFound()

        const nextName = patch.name ?? existing.name
        const nextColor = patch.color ?? existing.color
        const renaming = nextName !== existing.name

        if (renaming) {
          const collision = yield* db.query.projectTag
            .findFirst({
              columns: { name: true },
              where: and(
                eq(projectTag.projectId, projectId),
                eq(projectTag.name, nextName)
              )
            })
            .pipe(Effect.orDie)
          if (collision) return yield* new Conflict({ reason: "tag_exists" })
        }

        yield* db
          .update(projectTag)
          .set({ name: nextName, color: nextColor })
          .where(
            and(eq(projectTag.projectId, projectId), eq(projectTag.name, name))
          )
          .pipe(Effect.orDie)

        if (renaming) {
          yield* rewriteTagInTickets(orgSlug, slug, name, nextName)
        }

        return {
          name: makeTagName(nextName),
          color: makeTagColor(nextColor),
          createdBy: existing.createdBy,
          createdAt: existing.createdAt
        }
      })

    const remove = (
      orgSlug: string,
      userId: string,
      slug: string,
      name: string
    ): Effect.Effect<void, NotFound | Forbidden | MarkdownError> =>
      Effect.gen(function* () {
        yield* projects.requireRole(orgSlug, userId, slug, ["owner", "admin"])
        const projectId = yield* projectIdFromSlug(slug)

        const existingRow = yield* db.query.projectTag
          .findFirst({
            columns: { name: true },
            where: and(
              eq(projectTag.projectId, projectId),
              eq(projectTag.name, name)
            )
          })
          .pipe(Effect.orDie)
        if (!existingRow) return yield* new NotFound()

        yield* rewriteTagInTickets(orgSlug, slug, name, null)
        yield* db
          .delete(projectTag)
          .where(
            and(eq(projectTag.projectId, projectId), eq(projectTag.name, name))
          )
          .pipe(Effect.orDie)
      })

    return { list, listPaged, create, update, remove } satisfies TagsShape
  })
)

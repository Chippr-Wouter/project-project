import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { eq } from "drizzle-orm"
import { ulid } from "ulid"
import {
  Comment,
  CommentId,
  CreateCommentInput,
  Forbidden,
  NotFound,
  UpdateCommentInput,
  type MentionInvalid,
  type TicketId
} from "@projectproject/shared"
import { commentIndex } from "../db/schema"
import {
  type CommentBlock,
  parseCommentsRegion,
  serializeCommentsRegion,
  validateCommentBody
} from "../comments-region"
import { Db } from "../Services/Db"
import { Markdown, type MarkdownError } from "../Services/Markdown"
import { Projects } from "../Services/Projects"
import { TicketDocs } from "../Services/TicketDocs"
import { Users } from "../Services/Users"
import { validateBodyMentions } from "../Services/BodyMentions"
import {
  Comments,
  InvalidCommentBody,
  type CommentsShape
} from "../Services/Comments"

const decodeCommentId = Schema.decodeUnknownSync(CommentId)
const newCommentId = (): CommentId => decodeCommentId(`c_${ulid()}`)

export const CommentsLive = Layer.effect(
  Comments,
  Effect.gen(function* () {
    const db = yield* Db
    const md = yield* Markdown
    const projects = yield* Projects
    const ticketDocs = yield* TicketDocs
    const users = yield* Users

    const ensureMember = (orgSlug: string, userId: string, slug: string) =>
      projects.requireMember(orgSlug, userId, slug)

    const validateBody = (
      orgSlug: string,
      userId: string,
      slug: string,
      body: string
    ) =>
      Effect.gen(function* () {
        if (!body.includes("](mention:")) return
        const project = yield* projects.get(orgSlug, userId, slug)
        const memberIds = new Set<string>(project.members.map((m) => m.id))
        const ids = yield* ticketDocs.listIds(orgSlug, slug)
        const ticketIds = new Set<string>(ids)
        yield* validateBodyMentions(body, memberIds, ticketIds)
      })

    const readBlocks = (orgSlug: string, slug: string, ticketId: string) =>
      Effect.gen(function* () {
        const parts = yield* md.readTicketParts(orgSlug, slug, ticketId)
        return {
          description: parts.description,
          frontmatter: parts.data,
          blocks: parseCommentsRegion(parts.region)
        }
      })

    const writeBlocks = (
      orgSlug: string,
      slug: string,
      ticketId: string,
      frontmatter: Record<string, unknown>,
      description: string,
      blocks: ReadonlyArray<CommentBlock>
    ) =>
      md.writeTicketWithRegion(
        orgSlug,
        slug,
        ticketId,
        frontmatter,
        description,
        serializeCommentsRegion(blocks)
      )

    const list = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: TicketId
    ): Effect.Effect<ReadonlyArray<Comment>, NotFound | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        const rows = yield* db.query.commentIndex
          .findMany({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.projectSlug, slug),
                  _operators.eq(table.ticketId, ticketId)
                )!
            },
            orderBy: (c, { asc }) => [asc(c.createdAt)]
          })
          .pipe(Effect.orDie)
        if (rows.length === 0) return []
        const { blocks } = yield* readBlocks(orgSlug, slug, ticketId)
        const blockById = new Map(blocks.map((b) => [b.id, b]))
        const authors = yield* users.fullByIds(rows.map((r) => r.authorId))
        const authorById = new Map(authors.map((u) => [u.id, u]))
        return rows.flatMap((r): Comment[] => {
          const block = blockById.get(r.id)
          const author = authorById.get(r.authorId)
          if (!block || !author) return []
          return [
            {
              id: decodeCommentId(r.id),
              ticketId,
              projectSlug: slug,
              author,
              body: block.body,
              createdAt: r.createdAt,
              editedAt: r.editedAt ?? null
            }
          ]
        })
      })

    const create = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: TicketId,
      input: CreateCommentInput
    ): Effect.Effect<
      Comment,
      NotFound | InvalidCommentBody | MentionInvalid | MarkdownError
    > =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        const validation = validateCommentBody(input.body)
        if (!validation.ok) {
          return yield* new InvalidCommentBody({ reason: validation.reason })
        }
        yield* validateBody(orgSlug, userId, slug, input.body)
        const { description, frontmatter, blocks } = yield* readBlocks(
          orgSlug,
          slug,
          ticketId
        )
        const id = newCommentId()
        const now = yield* DateTime.nowAsDate

        yield* db
          .insert(commentIndex)
          .values({
            id,
            projectSlug: slug,
            ticketId,
            authorId: userId,
            createdAt: now,
            editedAt: null
          })
          .pipe(Effect.orDie)

        const next: CommentBlock = {
          id,
          author: userId,
          createdAt: now,
          editedAt: null,
          body: input.body
        }
        yield* writeBlocks(orgSlug, slug, ticketId, frontmatter, description, [
          ...blocks,
          next
        ]).pipe(
          Effect.tapError(() =>
            db
              .delete(commentIndex)
              .where(eq(commentIndex.id, id))
              .pipe(Effect.orDie)
          )
        )
        const author = yield* users
          .fullByIds([userId])
          .pipe(Effect.map((xs) => xs[0]))
        return {
          id,
          ticketId,
          projectSlug: slug,
          author,
          body: input.body,
          createdAt: now,
          editedAt: null
        }
      })

    const requireAuthor = (
      slug: string,
      ticketId: string,
      commentId: string,
      userId: string
    ): Effect.Effect<
      { authorId: string; createdAt: Date },
      NotFound | Forbidden
    > =>
      Effect.gen(function* () {
        const row = yield* db.query.commentIndex
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.and(
                  _operators.eq(table.id, commentId),
                  _operators.eq(table.projectSlug, slug),
                  _operators.eq(table.ticketId, ticketId)
                )!
            }
          })
          .pipe(Effect.orDie)
        if (!row) return yield* new NotFound()
        if (row.authorId !== userId) return yield* new Forbidden()
        return { authorId: row.authorId, createdAt: row.createdAt }
      })

    const edit = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: TicketId,
      commentId: CommentId,
      input: UpdateCommentInput
    ): Effect.Effect<
      Comment,
      NotFound | Forbidden | InvalidCommentBody | MentionInvalid | MarkdownError
    > =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        const validation = validateCommentBody(input.body)
        if (!validation.ok) {
          return yield* new InvalidCommentBody({ reason: validation.reason })
        }
        const meta = yield* requireAuthor(slug, ticketId, commentId, userId)
        yield* validateBody(orgSlug, userId, slug, input.body)
        const editedAt = yield* DateTime.nowAsDate
        yield* db
          .update(commentIndex)
          .set({ editedAt })
          .where(eq(commentIndex.id, commentId))
          .pipe(Effect.orDie)
        const { description, frontmatter, blocks } = yield* readBlocks(
          orgSlug,
          slug,
          ticketId
        )
        const nextBlocks = blocks.map((b) =>
          b.id === commentId ? { ...b, body: input.body, editedAt } : b
        )
        yield* writeBlocks(
          orgSlug,
          slug,
          ticketId,
          frontmatter,
          description,
          nextBlocks
        )
        const author = yield* users
          .fullByIds([userId])
          .pipe(Effect.map((xs) => xs[0]))
        return {
          id: commentId,
          ticketId,
          projectSlug: slug,
          author,
          body: input.body,
          createdAt: meta.createdAt,
          editedAt
        }
      })

    const remove = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: TicketId,
      commentId: CommentId
    ): Effect.Effect<void, NotFound | Forbidden | MarkdownError> =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        yield* requireAuthor(slug, ticketId, commentId, userId)
        yield* db
          .delete(commentIndex)
          .where(eq(commentIndex.id, commentId))
          .pipe(Effect.orDie)
        const { description, frontmatter, blocks } = yield* readBlocks(
          orgSlug,
          slug,
          ticketId
        )
        yield* writeBlocks(
          orgSlug,
          slug,
          ticketId,
          frontmatter,
          description,
          blocks.filter((b) => b.id !== commentId)
        )
      })

    return { list, create, edit, remove } satisfies CommentsShape
  })
)

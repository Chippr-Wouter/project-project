import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { and, eq } from "drizzle-orm"
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
import type { MarkdownError } from "../Services/Markdown"
import { Projects } from "../Services/Projects"
import { TicketIndex } from "../Services/TicketIndex"
import {
  type MalformedTicketDocument,
  TicketDocs
} from "../Services/TicketDocs"
import { Users } from "../Services/Users"
import { validateBodyMentionsWithLookups } from "../Services/BodyMentions"
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
    const projects = yield* Projects
    const ticketIndex = yield* TicketIndex
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
      validateBodyMentionsWithLookups(body, {
        existingTicketIds: (ticketIds) =>
          ticketIndex
            .projectFor(orgSlug, slug)
            .pipe(
              Effect.flatMap((project) =>
                ticketIndex.existingIds(project, ticketIds)
              )
            ),
        memberIds: () =>
          projects
            .get(orgSlug, userId, slug)
            .pipe(
              Effect.map(
                (project) =>
                  new Set<string>(project.members.map((member) => member.id))
              )
            )
      })

    const updateBlocks = (
      orgSlug: string,
      slug: string,
      ticketId: string,
      transform: (
        blocks: ReadonlyArray<CommentBlock>
      ) => ReadonlyArray<CommentBlock>,
      onPersist?: Effect.Effect<void>
    ) =>
      ticketDocs.update(
        orgSlug,
        slug,
        ticketId,
        (document) =>
          Effect.succeed({
            ...document,
            commentsRegion: serializeCommentsRegion(
              transform(parseCommentsRegion(document.commentsRegion))
            )
          }),
        () => onPersist ?? Effect.void
      )

    const list = (
      orgSlug: string,
      userId: string,
      slug: string,
      ticketId: TicketId
    ): Effect.Effect<
      ReadonlyArray<Comment>,
      NotFound | MarkdownError | MalformedTicketDocument
    > =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        const rows = yield* db.query.commentIndex
          .findMany({
            where: and(
              eq(commentIndex.projectSlug, slug),
              eq(commentIndex.ticketId, ticketId)
            ),
            orderBy: (c, { asc }) => [asc(c.createdAt)]
          })
          .pipe(Effect.orDie)
        if (rows.length === 0) return []
        const document = yield* ticketDocs.read(orgSlug, slug, ticketId)
        const blocks = parseCommentsRegion(document.commentsRegion)
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
      | NotFound
      | InvalidCommentBody
      | MentionInvalid
      | MarkdownError
      | MalformedTicketDocument
    > =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        const validation = validateCommentBody(input.body)
        if (!validation.ok) {
          return yield* new InvalidCommentBody({ reason: validation.reason })
        }
        yield* validateBody(orgSlug, userId, slug, input.body)
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
        yield* updateBlocks(orgSlug, slug, ticketId, (blocks) => [
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
            where: and(
              eq(commentIndex.id, commentId),
              eq(commentIndex.projectSlug, slug),
              eq(commentIndex.ticketId, ticketId)
            )
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
      | NotFound
      | Forbidden
      | InvalidCommentBody
      | MentionInvalid
      | MarkdownError
      | MalformedTicketDocument
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
        yield* updateBlocks(
          orgSlug,
          slug,
          ticketId,
          (blocks) =>
            blocks.map((block) =>
              block.id === commentId
                ? { ...block, body: input.body, editedAt }
                : block
            ),
          db
            .update(commentIndex)
            .set({ editedAt })
            .where(eq(commentIndex.id, commentId))
            .pipe(Effect.asVoid, Effect.orDie)
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
    ): Effect.Effect<
      void,
      NotFound | Forbidden | MarkdownError | MalformedTicketDocument
    > =>
      Effect.gen(function* () {
        yield* ensureMember(orgSlug, userId, slug)
        yield* requireAuthor(slug, ticketId, commentId, userId)
        yield* updateBlocks(
          orgSlug,
          slug,
          ticketId,
          (blocks) => blocks.filter((block) => block.id !== commentId),
          db
            .delete(commentIndex)
            .where(eq(commentIndex.id, commentId))
            .pipe(Effect.asVoid, Effect.orDie)
        )
      })

    return { list, create, edit, remove } satisfies CommentsShape
  })
)

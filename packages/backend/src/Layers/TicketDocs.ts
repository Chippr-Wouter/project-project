import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import {
  NotFound,
  PullRequestState,
  TagName,
  TicketId,
  TicketStatus
} from "@projectproject/shared"
import {
  Markdown,
  type MarkdownError,
  type TicketIdTaken
} from "../Services/Markdown"
import {
  MalformedTicketDocument,
  TicketDocs,
  type TicketDocsShape,
  type TicketDocument
} from "../Services/TicketDocs"

const TicketFrontmatter = Schema.Struct({
  id: TicketId,
  title: Schema.String,
  status: TicketStatus,
  type: Schema.Literals(["feat", "bug", "chore", "other"]),
  priority: Schema.Literals(["low", "med", "high"]).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("med" as const))
  ),
  tags: Schema.Array(TagName).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([]))
  ),
  branch: Schema.NullOr(Schema.String),
  pr: Schema.NullOr(Schema.Number).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  ),
  prState: Schema.NullOr(PullRequestState).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  ),
  lastTransitionedPr: Schema.NullOr(Schema.Number).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  ),
  assignees: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([]))
  ),
  archivedAt: Schema.NullOr(Schema.DateFromString).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  ),
  createdBy: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString
})

const decodeFrontmatter = Schema.decodeUnknownEffect(TicketFrontmatter)
const decodeTicketId = Schema.decodeUnknownEffect(TicketId)

function decodeFrontmatterCompat(raw: unknown) {
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>
    if (record.assignees === undefined && "assignee" in record) {
      const legacy = record.assignee
      record.assignees = typeof legacy === "string" ? [legacy] : []
    }
  }
  return decodeFrontmatter(raw)
}

function frontmatterToDisk(document: TicketDocument): Record<string, unknown> {
  return {
    id: document.id,
    title: document.title,
    status: document.status,
    type: document.type,
    priority: document.priority,
    tags: document.tags,
    branch: document.branch,
    pr: document.pr,
    prState: document.prState,
    lastTransitionedPr: document.lastTransitionedPr,
    assignees: document.assignees,
    archivedAt: document.archivedAt ? document.archivedAt.toISOString() : null,
    createdBy: document.createdBy,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  }
}

function toDocument(
  frontmatter: typeof TicketFrontmatter.Type,
  body: string,
  commentsRegion: string
): TicketDocument {
  return {
    ...frontmatter,
    body,
    commentsRegion
  }
}

const bodyWithCommentsRegion = (body: string, commentsRegion: string) =>
  commentsRegion ? `${body.replace(/\s+$/, "")}\n\n${commentsRegion}` : body

function withTicketDocTelemetry<A, E, R>(
  operation: string,
  orgSlug: string,
  slug: string,
  attributes: Record<string, unknown>,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
  const annotations = {
    module: "TicketDocs",
    operation,
    orgSlug,
    slug,
    ...attributes
  }
  return effect.pipe(
    Effect.withSpan(`TicketDocs.${operation}`, { attributes: annotations }),
    Effect.annotateLogs(annotations)
  )
}

export const TicketDocsLive = Layer.effect(
  TicketDocs,
  Effect.gen(function* () {
    const markdown = yield* Markdown
    const mutationLocks = new Map<
      string,
      { readonly semaphore: Semaphore.Semaphore; references: number }
    >()

    const withMutationLock = <A, E, R>(
      orgSlug: string,
      slug: string,
      id: string,
      effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E, R> => {
      const key = JSON.stringify([orgSlug, slug, id])
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          const current = mutationLocks.get(key)
          if (current) {
            current.references++
            return current
          }
          const created = {
            semaphore: Semaphore.makeUnsafe(1),
            references: 1
          }
          mutationLocks.set(key, created)
          return created
        }),
        (lock) => lock.semaphore.withPermits(1)(effect),
        (lock) =>
          Effect.sync(() => {
            lock.references--
            if (lock.references === 0 && mutationLocks.get(key) === lock) {
              mutationLocks.delete(key)
            }
          })
      )
    }

    const listIds = (
      orgSlug: string,
      slug: string
    ): Effect.Effect<ReadonlyArray<TicketId>, MarkdownError> =>
      withTicketDocTelemetry(
        "listIds",
        orgSlug,
        slug,
        {},
        markdown
          .listTicketIds(orgSlug, slug)
          .pipe(
            Effect.flatMap((ids) =>
              Effect.forEach(ids, (id) => decodeTicketId(id).pipe(Effect.orDie))
            )
          )
      )

    const read = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<
      TicketDocument,
      NotFound | MarkdownError | MalformedTicketDocument
    > =>
      withTicketDocTelemetry(
        "read",
        orgSlug,
        slug,
        { ticketId: id },
        Effect.gen(function* () {
          const file = yield* markdown.readTicketParts(orgSlug, slug, id)
          const frontmatter = yield* decodeFrontmatterCompat(file.data).pipe(
            Effect.mapError(
              (cause) =>
                new MalformedTicketDocument({
                  orgSlug,
                  slug,
                  ticketId: id,
                  path: `orgs/${orgSlug}/projects/${slug}/tickets/${id}.md`,
                  cause,
                  reason: "invalid_frontmatter"
                })
            )
          )
          return toDocument(frontmatter, file.description, file.region)
        })
      )

    const create = (
      orgSlug: string,
      slug: string,
      document: TicketDocument,
      onPersist?: (document: TicketDocument) => Effect.Effect<void>
    ): Effect.Effect<void, MarkdownError | TicketIdTaken> =>
      withTicketDocTelemetry(
        "create",
        orgSlug,
        slug,
        { ticketId: document.id },
        withMutationLock(
          orgSlug,
          slug,
          document.id,
          markdown
            .createTicketFile(
              orgSlug,
              slug,
              document.id,
              frontmatterToDisk(document),
              bodyWithCommentsRegion(document.body, document.commentsRegion)
            )
            .pipe(
              Effect.andThen(
                Effect.suspend(() =>
                  onPersist ? onPersist(document) : Effect.void
                )
              )
            )
        )
      )

    const write = (
      orgSlug: string,
      slug: string,
      id: string,
      document: TicketDocument
    ): Effect.Effect<void, MarkdownError> =>
      withTicketDocTelemetry(
        "write",
        orgSlug,
        slug,
        { ticketId: id },
        markdown.writeTicketWithRegion(
          orgSlug,
          slug,
          id,
          frontmatterToDisk(document),
          document.body,
          document.commentsRegion
        )
      )

    const update = <E, R>(
      orgSlug: string,
      slug: string,
      id: string,
      transform: (
        document: TicketDocument
      ) => Effect.Effect<TicketDocument, E, R>,
      onPersist?: (document: TicketDocument) => Effect.Effect<void, E, R>
    ): Effect.Effect<
      TicketDocument,
      NotFound | MarkdownError | MalformedTicketDocument | E,
      R
    > =>
      withTicketDocTelemetry(
        "update",
        orgSlug,
        slug,
        { ticketId: id },
        withMutationLock(
          orgSlug,
          slug,
          id,
          Effect.gen(function* () {
            const current = yield* read(orgSlug, slug, id)
            const next = yield* transform(current)
            if (next !== current) yield* write(orgSlug, slug, id, next)
            if (onPersist) yield* onPersist(next)
            return next
          })
        )
      )

    const remove = (
      orgSlug: string,
      slug: string,
      id: string,
      onPersist: Effect.Effect<void> = Effect.void
    ): Effect.Effect<void, NotFound | MarkdownError> =>
      withTicketDocTelemetry(
        "remove",
        orgSlug,
        slug,
        { ticketId: id },
        withMutationLock(
          orgSlug,
          slug,
          id,
          markdown
            .removeTicketFile(orgSlug, slug, id)
            .pipe(Effect.andThen(onPersist))
        )
      )

    const readRaw = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<
      { path: string; content: string },
      NotFound | MarkdownError
    > =>
      withTicketDocTelemetry(
        "readRaw",
        orgSlug,
        slug,
        { ticketId: id },
        markdown.readTicketFileRaw(orgSlug, slug, id)
      )

    return {
      listIds,
      read,
      create,
      write,
      update,
      remove,
      readRaw
    } satisfies TicketDocsShape
  })
)

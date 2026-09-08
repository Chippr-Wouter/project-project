import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
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
  branchAutoLinkDisabled: Schema.optional(Schema.Boolean),
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
    ...(document.branchAutoLinkDisabled
      ? { branchAutoLinkDisabled: true }
      : {}),
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
  body: string
): TicketDocument {
  return {
    ...frontmatter,
    body
  }
}

function withTicketDocTelemetry<A, E>(
  operation: string,
  orgSlug: string,
  slug: string,
  attributes: Record<string, unknown>,
  effect: Effect.Effect<A, E>
): Effect.Effect<A, E> {
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
          return toDocument(frontmatter, file.description)
        })
      )

    const create = (
      orgSlug: string,
      slug: string,
      document: TicketDocument
    ): Effect.Effect<void, MarkdownError | TicketIdTaken> =>
      withTicketDocTelemetry(
        "create",
        orgSlug,
        slug,
        { ticketId: document.id },
        markdown.createTicketFile(
          orgSlug,
          slug,
          document.id,
          frontmatterToDisk(document),
          document.body
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
        Effect.gen(function* () {
          const file = yield* markdown
            .readTicketParts(orgSlug, slug, id)
            .pipe(Effect.catchTag("NotFound", (error) => Effect.die(error)))
          yield* markdown.writeTicketWithRegion(
            orgSlug,
            slug,
            id,
            frontmatterToDisk(document),
            document.body,
            file.region
          )
        })
      )

    const remove = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<void, NotFound | MarkdownError> =>
      withTicketDocTelemetry(
        "remove",
        orgSlug,
        slug,
        { ticketId: id },
        markdown.removeTicketFile(orgSlug, slug, id)
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
      remove,
      readRaw
    } satisfies TicketDocsShape
  })
)

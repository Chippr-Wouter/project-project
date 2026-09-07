import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  Group,
  GroupId,
  GroupKind,
  NotFound,
  TicketId,
  type GroupDetail
} from "@projectproject/shared"
import {
  Markdown,
  type GroupIdTaken,
  type MarkdownError
} from "../Services/Markdown"
import {
  GroupDocs,
  type GroupDocsShape,
  type GroupDocument
} from "../Services/GroupDocs"

const GroupFrontmatter = Schema.Struct({
  ...Group.fields,
  kind: GroupKind.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("other" as const))
  ),
  tickets: Schema.Array(TicketId).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed([]))
  ),
  startsAt: Schema.NullOr(Schema.DateFromString).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  ),
  endsAt: Schema.NullOr(Schema.DateFromString).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  ),
  completedAt: Schema.NullOr(Schema.DateFromString).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(null))
  )
})

const decodeFrontmatter = Schema.decodeUnknownEffect(GroupFrontmatter)
const decodeGroupId = Schema.decodeUnknownEffect(GroupId)

function frontmatterToDisk(document: GroupDocument): Record<string, unknown> {
  return {
    id: document.id,
    name: document.name,
    kind: document.kind,
    tickets: document.tickets,
    color: document.color,
    startsAt: document.startsAt ? document.startsAt.toISOString() : null,
    endsAt: document.endsAt ? document.endsAt.toISOString() : null,
    completedAt: document.completedAt
      ? document.completedAt.toISOString()
      : null,
    createdBy: document.createdBy,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  }
}

function toDocument(
  group: typeof GroupFrontmatter.Type,
  body: string
): GroupDetail {
  return { ...group, body }
}

function withGroupDocTelemetry<A, E>(
  operation: string,
  orgSlug: string,
  slug: string,
  attributes: Record<string, unknown>,
  effect: Effect.Effect<A, E>
): Effect.Effect<A, E> {
  const annotations = {
    module: "GroupDocs",
    operation,
    orgSlug,
    slug,
    ...attributes
  }
  return effect.pipe(
    Effect.withSpan(`GroupDocs.${operation}`, { attributes: annotations }),
    Effect.annotateLogs(annotations)
  )
}

export const GroupDocsLive = Layer.effect(
  GroupDocs,
  Effect.gen(function* () {
    const markdown = yield* Markdown

    const listIds = (
      orgSlug: string,
      slug: string
    ): Effect.Effect<ReadonlyArray<GroupId>, MarkdownError> =>
      withGroupDocTelemetry(
        "listIds",
        orgSlug,
        slug,
        {},
        markdown
          .listGroupIds(orgSlug, slug)
          .pipe(
            Effect.flatMap((ids) =>
              Effect.forEach(ids, (id) => decodeGroupId(id).pipe(Effect.orDie))
            )
          )
      )

    const read = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<GroupDocument, NotFound | MarkdownError> =>
      withGroupDocTelemetry(
        "read",
        orgSlug,
        slug,
        { groupId: id },
        Effect.gen(function* () {
          const file = yield* markdown.readGroupFile(orgSlug, slug, id)
          const group = yield* decodeFrontmatter(file.data).pipe(Effect.orDie)
          return toDocument(group, file.body)
        })
      )

    const create = (
      orgSlug: string,
      slug: string,
      document: GroupDocument
    ): Effect.Effect<void, MarkdownError | GroupIdTaken> =>
      withGroupDocTelemetry(
        "create",
        orgSlug,
        slug,
        { groupId: document.id },
        markdown.createGroupFile(
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
      document: GroupDocument
    ): Effect.Effect<void, MarkdownError> =>
      withGroupDocTelemetry(
        "write",
        orgSlug,
        slug,
        { groupId: id },
        markdown.writeGroupFile(
          orgSlug,
          slug,
          id,
          frontmatterToDisk(document),
          document.body
        )
      )

    const writeIfExists = (
      orgSlug: string,
      slug: string,
      id: string,
      document: GroupDocument
    ): Effect.Effect<void, NotFound | MarkdownError> =>
      withGroupDocTelemetry(
        "writeIfExists",
        orgSlug,
        slug,
        { groupId: id },
        markdown.writeGroupFileIfExists(
          orgSlug,
          slug,
          id,
          frontmatterToDisk(document),
          document.body
        )
      )

    const remove = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<void, NotFound | MarkdownError> =>
      withGroupDocTelemetry(
        "remove",
        orgSlug,
        slug,
        { groupId: id },
        markdown.removeGroupFile(orgSlug, slug, id)
      )

    const readRaw = (
      orgSlug: string,
      slug: string,
      id: string
    ): Effect.Effect<
      { path: string; content: string },
      NotFound | MarkdownError
    > =>
      withGroupDocTelemetry(
        "readRaw",
        orgSlug,
        slug,
        { groupId: id },
        markdown.readGroupFileRaw(orgSlug, slug, id)
      )

    return {
      listIds,
      read,
      create,
      write,
      writeIfExists,
      remove,
      readRaw
    } satisfies GroupDocsShape
  })
)

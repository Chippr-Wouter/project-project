import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { GroupDetail, GroupId, NotFound } from "@projectproject/shared"
import type { GroupIdTaken, MarkdownError } from "./Markdown"

export type GroupDocument = GroupDetail

export interface GroupDocsShape {
  readonly listIds: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<ReadonlyArray<GroupId>, MarkdownError>
  readonly read: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<GroupDocument, NotFound | MarkdownError>
  readonly create: (
    orgSlug: string,
    slug: string,
    document: GroupDocument
  ) => Effect.Effect<void, MarkdownError | GroupIdTaken>
  readonly write: (
    orgSlug: string,
    slug: string,
    id: string,
    document: GroupDocument
  ) => Effect.Effect<void, MarkdownError>
  readonly writeIfExists: (
    orgSlug: string,
    slug: string,
    id: string,
    document: GroupDocument
  ) => Effect.Effect<void, NotFound | MarkdownError>
  readonly remove: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<void, NotFound | MarkdownError>
  readonly readRaw: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<
    { path: string; content: string },
    NotFound | MarkdownError
  >
}

export class GroupDocs extends Context.Service<GroupDocs, GroupDocsShape>()(
  "@projectproject/backend/Services/GroupDocs"
) {}

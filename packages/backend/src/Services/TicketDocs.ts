import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type {
  NotFound,
  PullRequestState,
  TagName,
  TicketId,
  TicketPriority,
  TicketStatus,
  TicketType
} from "@projectproject/shared"
import type { MarkdownError, TicketIdTaken } from "./Markdown"

export class MalformedTicketDocument extends Data.TaggedError(
  "MalformedTicketDocument"
)<{
  readonly orgSlug: string
  readonly slug: string
  readonly ticketId: string
  readonly path: string
  readonly reason: string
  readonly cause: unknown
}> {}

export interface TicketDocument {
  readonly id: TicketId
  readonly title: string
  readonly status: TicketStatus
  readonly type: TicketType
  readonly priority: TicketPriority
  readonly tags: ReadonlyArray<TagName>
  readonly branch: string | null
  readonly branchAutoLinkDisabled?: boolean
  readonly pr: number | null
  readonly prState: PullRequestState | null
  readonly lastTransitionedPr: number | null
  readonly assignees: ReadonlyArray<string>
  readonly archivedAt: Date | null
  readonly createdBy: string
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly body: string
  readonly commentsRegion: string
}

export interface TicketDocsShape {
  readonly listIds: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<ReadonlyArray<TicketId>, MarkdownError>
  readonly read: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<
    TicketDocument,
    NotFound | MarkdownError | MalformedTicketDocument
  >
  readonly create: (
    orgSlug: string,
    slug: string,
    document: TicketDocument,
    onPersist?: (document: TicketDocument) => Effect.Effect<void>
  ) => Effect.Effect<void, MarkdownError | TicketIdTaken>
  readonly write: (
    orgSlug: string,
    slug: string,
    id: string,
    document: TicketDocument
  ) => Effect.Effect<void, MarkdownError>
  readonly update: <E, R>(
    orgSlug: string,
    slug: string,
    id: string,
    transform: (
      document: TicketDocument
    ) => Effect.Effect<TicketDocument, E, R>,
    onPersist?: (document: TicketDocument) => Effect.Effect<void, E, R>
  ) => Effect.Effect<
    TicketDocument,
    NotFound | MarkdownError | MalformedTicketDocument | E,
    R
  >
  readonly remove: (
    orgSlug: string,
    slug: string,
    id: string,
    onPersist?: Effect.Effect<void>
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

export class TicketDocs extends Context.Service<TicketDocs, TicketDocsShape>()(
  "@projectproject/backend/Services/TicketDocs"
) {}

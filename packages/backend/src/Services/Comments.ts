import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type {
  Comment,
  CommentId,
  CreateCommentInput,
  Forbidden,
  MentionInvalid,
  NotFound,
  TicketId,
  UpdateCommentInput
} from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"

export class InvalidCommentBody extends Data.TaggedError("InvalidCommentBody")<{
  readonly reason: string
}> {}

export interface CommentsShape {
  readonly list: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: TicketId
  ) => Effect.Effect<ReadonlyArray<Comment>, NotFound | MarkdownError>
  readonly create: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: TicketId,
    input: CreateCommentInput
  ) => Effect.Effect<
    Comment,
    NotFound | InvalidCommentBody | MentionInvalid | MarkdownError
  >
  readonly edit: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: TicketId,
    commentId: CommentId,
    input: UpdateCommentInput
  ) => Effect.Effect<
    Comment,
    NotFound | Forbidden | InvalidCommentBody | MentionInvalid | MarkdownError
  >
  readonly remove: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: TicketId,
    commentId: CommentId
  ) => Effect.Effect<void, NotFound | Forbidden | MarkdownError>
}

export class Comments extends Context.Service<Comments, CommentsShape>()(
  "@projectproject/backend/Services/Comments"
) {}

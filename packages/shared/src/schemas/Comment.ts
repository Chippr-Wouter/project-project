import * as Schema from "effect/Schema"
import { User } from "./User"
import { TicketId } from "./Ticket"
import { Slug } from "./Project"

export const CommentId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^c_[A-Za-z0-9_-]+$/)),
  Schema.brand("CommentId")
)
export type CommentId = typeof CommentId.Type

export const Comment = Schema.Struct({
  id: CommentId,
  ticketId: TicketId,
  projectSlug: Slug,
  author: User,
  body: Schema.String,
  createdAt: Schema.DateFromString,
  editedAt: Schema.NullOr(Schema.DateFromString)
})
export type Comment = typeof Comment.Type

export const CreateCommentInput = Schema.Struct({
  body: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(20_000))
  )
})
export type CreateCommentInput = typeof CreateCommentInput.Type

export const UpdateCommentInput = Schema.Struct({
  body: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(20_000))
  )
})
export type UpdateCommentInput = typeof UpdateCommentInput.Type

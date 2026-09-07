import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import {
  CommentId,
  TicketId,
  type CreateCommentInput,
  type UpdateCommentInput
} from "@projectproject/shared"

const makeTicketId = Schema.decodeUnknownSync(TicketId)
const makeCommentId = Schema.decodeUnknownSync(CommentId)

export const commentsKey = (orgSlug: string, slug: string, id: TicketId) =>
  `${orgSlug}/${slug}/${id}`

export const commentKey = (
  orgSlug: string,
  slug: string,
  id: TicketId,
  commentId: CommentId
) => `${orgSlug}/${slug}/${id}/${commentId}`

const splitKey = (key: string) => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    id: makeTicketId(parts.slice(2).join("/"))
  }
}

const splitCommentKey = (key: string) => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    id: makeTicketId(parts[2]),
    commentId: makeCommentId(parts.slice(3).join("/"))
  }
}

const commentsBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.ticketComments.list({
          params: { orgSlug, slug, id }
        })
      })
    )
    .pipe(Atom.setIdleTTL("5 minutes"))
})

export const commentsAtom = Atom.family((key: string) =>
  Atom.optimistic(commentsBaseAtom(key))
)

export const createCommentAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitKey(key)
  return Atom.optimisticFn(commentsAtom(key), {
    reducer: (current, _input: CreateCommentInput) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: CreateCommentInput, get) {
        const client = yield* ApiClient
        const created = yield* client.ticketComments.create({
          params: { orgSlug, slug, id },
          payload: input
        })
        get.refresh(commentsBaseAtom(key))
        return created
      })
    )
  })
})

export const editCommentAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id, commentId } = splitCommentKey(key)
  const listKey = commentsKey(orgSlug, slug, id)
  return Atom.optimisticFn(commentsAtom(listKey), {
    reducer: (current, input: UpdateCommentInput) => {
      if (!Result.isSuccess(current)) return current
      const editedAt = DateTime.toDate(DateTime.nowUnsafe())
      const next = current.value.map((c) =>
        c.id === commentId ? { ...c, body: input.body, editedAt } : c
      )
      return Result.success([...next], { waiting: true })
    },
    fn: runtime.fn(
      Effect.fn(function* (input: UpdateCommentInput, get) {
        const client = yield* ApiClient
        const updated = yield* client.ticketComments.update({
          params: { orgSlug, slug, id, commentId },
          payload: { body: input.body }
        })
        get.refresh(commentsBaseAtom(listKey))
        return updated
      })
    )
  })
})

export const deleteCommentAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id, commentId } = splitCommentKey(key)
  const listKey = commentsKey(orgSlug, slug, id)
  return Atom.optimisticFn(commentsAtom(listKey), {
    reducer: (current, _input: void) => {
      if (!Result.isSuccess(current)) return current
      return Result.success(
        current.value.filter((c) => c.id !== commentId),
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        yield* client.ticketComments.delete({
          params: { orgSlug, slug, id, commentId }
        })
        get.refresh(commentsBaseAtom(listKey))
        return commentId
      })
    )
  })
})

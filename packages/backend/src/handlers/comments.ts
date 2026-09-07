import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser, Validation } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { Comments } from "../Services/Comments"
import { CurrentOrg } from "../Services/CurrentOrg"
import { dieOnMarkdown } from "./lib"

export const CommentsHandlerLive = HttpApiBuilder.group(
  AppApi,
  "ticketComments",
  (handlers) =>
    handlers
      .handle("list", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const comments = yield* Comments
          return yield* comments.list(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("create", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const comments = yield* Comments
          return yield* comments.create(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(
          Effect.catchTag("InvalidCommentBody", (error) =>
            Effect.fail(new Validation({ reason: error.reason }))
          ),
          dieOnMarkdown
        )
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const comments = yield* Comments
          return yield* comments.edit(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            params.commentId,
            payload
          )
        }).pipe(
          Effect.catchTag("InvalidCommentBody", (error) =>
            Effect.fail(new Validation({ reason: error.reason }))
          ),
          dieOnMarkdown
        )
      )
      .handle("delete", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const comments = yield* Comments
          yield* comments.remove(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            params.commentId
          )
        }).pipe(dieOnMarkdown)
      )
)

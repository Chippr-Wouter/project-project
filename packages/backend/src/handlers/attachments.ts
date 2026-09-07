import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { Attachments } from "../Services/Attachments"

export const AttachmentsHandlerLive = HttpApiBuilder.group(
  AppApi,
  "attachments",
  (handlers) =>
    handlers
      .handle("prepare", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const attachments = yield* Attachments
          return yield* attachments.prepare(
            params.orgSlug,
            params.slug,
            params.id,
            user.id,
            payload
          )
        })
      )
      .handle("list", ({ params, query }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const attachments = yield* Attachments
          return yield* attachments.listForOrg(params.orgSlug, user.id, query)
        })
      )
      .handle("summary", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const attachments = yield* Attachments
          return yield* attachments.summarizeForOrg(params.orgSlug, user.id)
        })
      )
      .handle("remove", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const attachments = yield* Attachments
          return yield* attachments.deleteForOrg(
            params.orgSlug,
            params.attachmentId,
            user.id
          )
        })
      )
      .handle("commit", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const attachments = yield* Attachments
          return yield* attachments.commit(
            params.orgSlug,
            params.slug,
            params.id,
            user.id,
            params.attachmentId
          )
        })
      )
)

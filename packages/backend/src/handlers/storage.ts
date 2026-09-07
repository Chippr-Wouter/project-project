import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { OrgStorage } from "../Services/OrgStorage"

export const StorageHandlerLive = HttpApiBuilder.group(
  AppApi,
  "storage",
  (handlers) =>
    handlers
      .handle("get", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const storage = yield* OrgStorage
          return yield* storage.getStatus(params.orgSlug, user.id)
        })
      )
      .handle("connect", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const storage = yield* OrgStorage
          return yield* storage.connect(params.orgSlug, user.id, payload)
        })
      )
      .handle("disconnect", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const storage = yield* OrgStorage
          return yield* storage.disconnect(params.orgSlug, user.id)
        })
      )
)

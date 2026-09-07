import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { Org } from "../Services/Org"

export const OrgHandlerLive = HttpApiBuilder.group(AppApi, "org", (handlers) =>
  handlers
    .handle("myOrgs", () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const org = yield* Org
        return yield* org.myOrgs(user.id)
      })
    )
    .handle("get", ({ params }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const org = yield* Org
        return yield* org.get(params.orgSlug, user.id)
      })
    )
    .handle("softDelete", ({ params }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const org = yield* Org
        return yield* org.softDelete(params.orgSlug, user.id)
      })
    )
    .handle("restore", ({ params }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        const org = yield* Org
        return yield* org.restore(params.orgSlug, user.id)
      })
    )
)

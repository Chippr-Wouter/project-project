import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { CurrentOrg } from "../Services/CurrentOrg"
import { EverhourIntegrations } from "../Services/EverhourIntegrations"
import { ProjectStatuses } from "../Services/ProjectStatuses"
import { dieOnMarkdown } from "./lib"

export const StatusesHandlerLive = HttpApiBuilder.group(
  AppApi,
  "statuses",
  (handlers) =>
    handlers
      .handle("list", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const svc = yield* ProjectStatuses
          return yield* svc.list(org.orgSlug, user.id, params.slug)
        })
      )
      .handle("create", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const svc = yield* ProjectStatuses
          return yield* svc.create(org.orgSlug, user.id, params.slug, payload)
        })
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const svc = yield* ProjectStatuses
          const result = yield* svc
            .update(
              org.orgSlug,
              user.id,
              params.slug,
              params.statusSlug,
              payload
            )
            .pipe(dieOnMarkdown)
          const everhour = yield* EverhourIntegrations
          yield* everhour.bestEffortProjectSync(
            org.orgSlug,
            user.id,
            params.slug
          )
          return result
        })
      )
      .handle("reorder", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const svc = yield* ProjectStatuses
          return yield* svc.reorder(
            org.orgSlug,
            user.id,
            params.slug,
            params.statusSlug,
            payload
          )
        })
      )
      .handle("remove", ({ params, query }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const svc = yield* ProjectStatuses
          const result = yield* svc
            .remove(org.orgSlug, user.id, params.slug, params.statusSlug, {
              reassignTo: query.reassignTo
            })
            .pipe(dieOnMarkdown)
          const everhour = yield* EverhourIntegrations
          yield* everhour.bestEffortProjectSync(
            org.orgSlug,
            user.id,
            params.slug
          )
          return result
        })
      )
)

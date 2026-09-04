import { HttpApiBuilder } from "@effect/platform"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { CurrentOrg } from "../Services/CurrentOrg"
import { FigmaIntegrations } from "../Services/FigmaIntegrations"

export const FigmaHandlerLive = HttpApiBuilder.group(
  AppApi,
  "figma",
  (handlers) =>
    handlers
      .handle("profile", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const integrations = yield* FigmaIntegrations
          return yield* integrations.getProfile(user.id)
        })
      )
      .handle("disconnectProfile", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const integrations = yield* FigmaIntegrations
          return yield* integrations.disconnectProfile(user.id)
        })
      )
      .handle("projectStatus", ({ path }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(path.orgSlug, user.id)
          const integrations = yield* FigmaIntegrations
          return yield* integrations.getProjectStatus(
            org.orgSlug,
            user.id,
            path.slug
          )
        })
      )
      .handle("connectProject", ({ path, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(path.orgSlug, user.id)
          const integrations = yield* FigmaIntegrations
          return yield* integrations.connectProject(
            org.orgSlug,
            user.id,
            path.slug,
            payload.accessToken
          )
        })
      )
      .handle("disconnectProject", ({ path }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(path.orgSlug, user.id)
          const integrations = yield* FigmaIntegrations
          return yield* integrations.disconnectProject(
            org.orgSlug,
            user.id,
            path.slug
          )
        })
      )
)

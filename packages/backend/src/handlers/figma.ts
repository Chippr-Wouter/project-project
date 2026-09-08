import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { CurrentOrg } from "../Services/CurrentOrg"
import { FigmaIntegrations } from "../Services/FigmaIntegrations"
import { FigmaLinks } from "../Services/FigmaLinks"

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
      .handle("projectStatus", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* FigmaIntegrations
          return yield* integrations.getProjectStatus(
            org.orgSlug,
            user.id,
            params.slug
          )
        })
      )
      .handle("connectProject", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* FigmaIntegrations
          return yield* integrations.connectProject(
            org.orgSlug,
            user.id,
            params.slug,
            payload.accessToken
          )
        })
      )
      .handle("disconnectProject", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* FigmaIntegrations
          return yield* integrations.disconnectProject(
            org.orgSlug,
            user.id,
            params.slug
          )
        })
      )
      .handle("ticketLinks", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const figmaLinks = yield* FigmaLinks
          return yield* figmaLinks.listForTicket(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        })
      )
)

import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { CurrentOrg } from "../Services/CurrentOrg"
import { EverhourIntegrations } from "../Services/EverhourIntegrations"
import { EverhourTimeTracking } from "../Services/EverhourTimeTracking"

export const EverhourHandlerLive = HttpApiBuilder.group(
  AppApi,
  "everhour",
  (handlers) =>
    handlers
      .handle("profile", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const integrations = yield* EverhourIntegrations
          return yield* integrations.getProfile(user.id)
        })
      )
      .handle("connectProfile", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const integrations = yield* EverhourIntegrations
          return yield* integrations.connectProfile(user.id, payload.apiKey)
        })
      )
      .handle("disconnectProfile", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const integrations = yield* EverhourIntegrations
          return yield* integrations.disconnectProfile(user.id)
        })
      )
      .handle("projectStatus", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* EverhourIntegrations
          return yield* integrations.getProjectStatus(
            org.orgSlug,
            user.id,
            params.slug
          )
        })
      )
      .handle("connectProject", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* EverhourIntegrations
          return yield* integrations.connectProject(
            org.orgSlug,
            user.id,
            params.slug
          )
        })
      )
      .handle("syncProject", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* EverhourIntegrations
          return yield* integrations.syncProject(
            org.orgSlug,
            user.id,
            params.slug
          )
        })
      )
      .handle("disconnectProject", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const integrations = yield* EverhourIntegrations
          return yield* integrations.disconnectProject(
            org.orgSlug,
            user.id,
            params.slug
          )
        })
      )
      .handle("ticketWorkTypes", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.workTypesForTicket(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        })
      )
      .handle("startTicketTimer", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.startTicketTimer(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        })
      )
      .handle("startSprintTimer", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.startSprintTimer(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        })
      )
      .handle("stopTimer", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.stopTimer(org.orgSlug, user.id)
        })
      )
      .handle("currentTimer", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.currentTimer(org.orgSlug, user.id)
        })
      )
      .handle("logTime", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.logTime(org.orgSlug, user.id, params.slug, payload)
        })
      )
      .handle("ticketTime", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const time = yield* EverhourTimeTracking
          return yield* time.ticketTimeSummary(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        })
      )
)

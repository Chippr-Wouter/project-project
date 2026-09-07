import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { CurrentOrg } from "../Services/CurrentOrg"
import { EverhourIntegrations } from "../Services/EverhourIntegrations"
import { Groups } from "../Services/Groups"
import { Tickets } from "../Services/Tickets"
import { dieOnMarkdown } from "./lib"

export const GroupsHandlerLive = HttpApiBuilder.group(
  AppApi,
  "groups",
  (handlers) =>
    handlers
      .handle("list", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          return yield* groups.list(org.orgSlug, user.id, params.slug)
        }).pipe(dieOnMarkdown)
      )
      .handle("create", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          const result = yield* groups.create(
            org.orgSlug,
            user.id,
            params.slug,
            payload
          )
          const everhour = yield* EverhourIntegrations
          yield* everhour.bestEffortProjectSync(
            org.orgSlug,
            user.id,
            params.slug
          )
          return result
        }).pipe(dieOnMarkdown)
      )
      .handle("get", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          return yield* groups.get(org.orgSlug, user.id, params.slug, params.id)
        }).pipe(dieOnMarkdown)
      )
      .handle("listTickets", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.listInGroup(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          const result = yield* groups.update(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
          const everhour = yield* EverhourIntegrations
          yield* everhour.bestEffortProjectSync(
            org.orgSlug,
            user.id,
            params.slug
          )
          return result
        }).pipe(dieOnMarkdown)
      )
      .handle("updateTickets", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          return yield* groups.updateTickets(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("updateTicketOrder", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          return yield* groups.updateTicketOrder(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("complete", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          const result = yield* groups.complete(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
          const everhour = yield* EverhourIntegrations
          yield* everhour.bestEffortProjectSync(
            org.orgSlug,
            user.id,
            params.slug
          )
          return result
        }).pipe(dieOnMarkdown)
      )
      .handle("delete", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const groups = yield* Groups
          yield* groups.remove(org.orgSlug, user.id, params.slug, params.id)
          const everhour = yield* EverhourIntegrations
          yield* everhour.bestEffortProjectSync(
            org.orgSlug,
            user.id,
            params.slug
          )
        }).pipe(dieOnMarkdown)
      )
)

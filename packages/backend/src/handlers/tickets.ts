// Thin handlers for the `tickets` HttpApi group. All logic in Tickets.

import { HttpApiBuilder } from "effect/unstable/httpapi"
import {
  AppApi,
  CurrentUser,
  ticketListQueryFromSearch,
  Validation
} from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { CurrentOrg } from "../Services/CurrentOrg"
import { Tickets } from "../Services/Tickets"
import { dieOnMarkdown } from "./lib"

export const TicketsHandlerLive = HttpApiBuilder.group(
  AppApi,
  "tickets",
  (handlers) =>
    handlers
      .handle("list", ({ params, query }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.list(
            org.orgSlug,
            user.id,
            params.slug,
            ticketListQueryFromSearch(query)
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("search", ({ params, query }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          const limitNum =
            query.limit !== undefined
              ? Number.parseInt(query.limit, 10)
              : undefined
          return yield* tickets.search(org.orgSlug, user.id, params.slug, {
            q: query.q,
            excludeGroupId: query.excludeGroupId,
            limit:
              limitNum !== undefined && Number.isFinite(limitNum)
                ? limitNum
                : undefined
          })
        }).pipe(dieOnMarkdown)
      )
      .handle("count", ({ params, query }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.count(
            org.orgSlug,
            user.id,
            params.slug,
            ticketListQueryFromSearch(query)
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("quickCreate", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.quickCreate(
            org.orgSlug,
            user.id,
            params.slug,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("create", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.create(
            org.orgSlug,
            user.id,
            params.slug,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("get", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.get(
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
          const tickets = yield* Tickets
          return yield* tickets.update(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("delete", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          yield* tickets.remove(org.orgSlug, user.id, params.slug, params.id)
        }).pipe(dieOnMarkdown)
      )
      .handle("archive", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.archive(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload.reason
          )
        }).pipe(
          Effect.catchTag("InvalidCommentBody", (error) =>
            Effect.fail(new Validation({ reason: error.reason }))
          ),
          dieOnMarkdown
        )
      )
      .handle("unarchive", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.unarchive(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("createBranch", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.createBranch(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("openPr", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.openPr(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("clearBranch", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.clearBranch(
            org.orgSlug,
            user.id,
            params.slug,
            params.id
          )
        }).pipe(dieOnMarkdown)
      )
      .handle("attachBranch", ({ params, payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const currentOrg = yield* CurrentOrg
          const org = yield* currentOrg.resolve(params.orgSlug, user.id)
          const tickets = yield* Tickets
          return yield* tickets.attachBranch(
            org.orgSlug,
            user.id,
            params.slug,
            params.id,
            payload
          )
        }).pipe(dieOnMarkdown)
      )
)

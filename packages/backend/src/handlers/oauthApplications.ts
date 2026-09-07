import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser, Validation } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { toWebHeaders } from "../http/toWebHeaders"
import { BetterAuth, type BetterAuthError } from "../Services/BetterAuth"
import { OAuthApplications } from "../Services/OAuthApplications"

export const consentErrorToFailure = (e: BetterAuthError) => {
  const cause = e.cause as
    | {
        statusCode?: unknown
        body?: { message?: unknown; code?: unknown; error?: unknown }
      }
    | undefined
  const status =
    cause && typeof cause.statusCode === "number" ? cause.statusCode : undefined
  if (status !== undefined && status >= 400 && status < 500) {
    const message =
      cause?.body && typeof cause.body.message === "string"
        ? cause.body.message
        : typeof cause?.body?.code === "string"
          ? cause.body.code
          : typeof cause?.body?.error === "string"
            ? cause.body.error
            : "consent_failed"
    return Effect.fail(new Validation({ reason: message }))
  }
  return Effect.die(e)
}

export const OAuthApplicationsHandlerLive = HttpApiBuilder.group(
  AppApi,
  "oauthApplications",
  (handlers) =>
    handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const svc = yield* OAuthApplications
          return yield* svc.listForUser(user.id)
        })
      )
      .handle("revoke", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser
          const svc = yield* OAuthApplications
          yield* svc.revokeForUser(user.id, params.id)
          return { ok: true } as const
        })
      )
      .handle("consent", ({ payload }) =>
        Effect.gen(function* () {
          yield* CurrentUser
          const ba = yield* BetterAuth
          const req = yield* HttpServerRequest.HttpServerRequest
          const result = yield* ba
            .submitConsent(toWebHeaders(req.headers), payload)
            .pipe(Effect.catchTag("BetterAuthError", consentErrorToFailure))
          return { redirectURI: result.redirectURI }
        })
      )
)

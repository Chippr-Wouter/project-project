import { isAPIError } from "better-auth/api"
import { HttpServerRequest } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser, Validation } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { toWebHeaders } from "../http/toWebHeaders"
import { BetterAuth, type BetterAuthError } from "../Services/BetterAuth"
import { OAuthApplications } from "../Services/OAuthApplications"

export const consentErrorToFailure = (error: BetterAuthError) => {
  const { cause } = error

  if (!isAPIError(cause) || cause.statusCode < 400 || cause.statusCode >= 500) {
    return Effect.die(error)
  }

  const body = cause.body
  const oauthError: unknown = body?.error
  const reason =
    body?.message ??
    body?.code ??
    (typeof oauthError === "string" ? oauthError : "consent_failed")

  return Effect.fail(new Validation({ reason }))
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

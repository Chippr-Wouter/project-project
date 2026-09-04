import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "@effect/platform"
import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import { toWebHeaders } from "./toWebHeaders"
import { BetterAuth } from "../Services/BetterAuth"
import { FigmaIntegrations } from "../Services/FigmaIntegrations"

const publicBaseUrl = Config.string("BETTER_AUTH_URL").pipe(
  Config.withDefault("http://localhost:5173")
)

const profileSettingsUrl = (params?: Record<string, string>) =>
  Effect.gen(function* () {
    const baseUrl = yield* publicBaseUrl.pipe(Effect.orDie)
    const url = new URL("/profile", baseUrl)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }
    return url.toString()
  })

const requireSession = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const ba = yield* BetterAuth
  const session = yield* ba
    .getSession(toWebHeaders(req.headers))
    .pipe(Effect.orElseSucceed(() => null))
  return session
})

const figmaOauthStartRoute = Effect.gen(function* () {
  const session = yield* requireSession
  if (session === null) {
    return HttpServerResponse.text("Unauthorized", { status: 401 })
  }
  const integrations = yield* FigmaIntegrations
  const { authorizeUrl } = yield* integrations.beginProfileConnect(
    session.user.id
  )
  return HttpServerResponse.redirect(authorizeUrl, { status: 302 })
}).pipe(
  Effect.catchTag("FigmaError", () =>
    Effect.gen(function* () {
      const redirectUrl = yield* profileSettingsUrl({
        figmaError: "figma_oauth_start_failed"
      })
      return HttpServerResponse.redirect(redirectUrl, { status: 302 })
    })
  ),
  Effect.catchAllCause((cause) =>
    Effect.gen(function* () {
      yield* Effect.logError("figma oauth start route failure", cause)
      const redirectUrl = yield* profileSettingsUrl({
        figmaError: "figma_oauth_start_failed"
      })
      return HttpServerResponse.redirect(redirectUrl, { status: 302 })
    })
  )
)

const figmaOauthCallbackRoute = Effect.gen(function* () {
  const session = yield* requireSession
  if (session === null) {
    return HttpServerResponse.text("Unauthorized", { status: 401 })
  }
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const url = new URL(webReq.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    const redirectUrl = yield* profileSettingsUrl({
      figmaError: "figma_oauth_callback_invalid"
    })
    return HttpServerResponse.redirect(redirectUrl, { status: 302 })
  }
  const integrations = yield* FigmaIntegrations
  yield* integrations.completeProfileConnect(session.user.id, code, state)
  const redirectUrl = yield* profileSettingsUrl()
  return HttpServerResponse.redirect(redirectUrl, { status: 302 })
}).pipe(
  Effect.catchTags({
    FigmaAuthInvalid: () =>
      Effect.gen(function* () {
        const redirectUrl = yield* profileSettingsUrl({
          figmaError: "figma_oauth_callback_invalid"
        })
        return HttpServerResponse.redirect(redirectUrl, { status: 302 })
      }),
    FigmaError: () =>
      Effect.gen(function* () {
        const redirectUrl = yield* profileSettingsUrl({
          figmaError: "figma_oauth_callback_failed"
        })
        return HttpServerResponse.redirect(redirectUrl, { status: 302 })
      })
  }),
  Effect.catchAllCause((cause) =>
    Effect.gen(function* () {
      yield* Effect.logError("figma oauth callback route failure", cause)
      const redirectUrl = yield* profileSettingsUrl({
        figmaError: "figma_oauth_callback_failed"
      })
      return HttpServerResponse.redirect(redirectUrl, { status: 302 })
    })
  )
)

export const figmaOauthRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/start", figmaOauthStartRoute),
  HttpRouter.get("/callback", figmaOauthCallbackRoute)
)

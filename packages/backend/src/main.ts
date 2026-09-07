// packages/backend/src/main.ts
//
// Backend entry point. This file's only job is to wire up the HttpApi from
// the shared package, attach an implementation, and run the resulting Layer
// on a Bun HTTP server.
//
// THE EFFECT MENTAL MODEL (one paragraph)
// ----------------------------------------------------------------------------
// An `Effect<A, E, R>` is a *description* of a computation. It does nothing
// until it is run by a runtime. `Layer<ROut, E, RIn>` is a description of how
// to construct services (the things in the `R` channel). You compose layers
// to build the dependency graph for your program, then a runtime resolves
// it. For HTTP, `@effect/platform` provides ready-made layers: one to
// implement an HttpApi (`HttpApiBuilder.api`), one to actually listen on a
// port (`BunHttpServer.layer` from `@effect/platform-bun`).
//
// WHAT'S IN THIS FILE
// ----------------------------------------------------------------------------
// Handler groups implement the contract from `@projectproject/shared`, and the
// runtime module provides the service graph they call into. Three mounts under
// the shared `/api` namespace coexist on the same
// Bun server:
//
//   - `/api/auth/*` — handed off to Better Auth's own request handler,
//                     mounted as a raw web app (it has its own routing,
//                     schemas, and cookie management).
//   - `/api/integrations/github/*` — GitHub App setup, OAuth callback, and
//                                    webhook endpoints.
//   - `/api/*`      — handled by the typed HttpApi pipeline (`/api/me`,
//                     `/api/health`, `/api/db/ping`).
//
// Order matters: `/api/auth` is registered first so its more-specific prefix
// wins the match; `/api/*` is the catch-all for everything else.
//
// The `/api` prefix is owned by the backend, not the frontend dev server.
// Vite's proxy in `packages/frontend/vite.config.ts` is a pure forwarder —
// no path rewriting — so a browser request to `:5173/api/me` arrives here
// as `:3000/api/me` exactly. Direct backend curls (`curl :3000/api/me`)
// hit the same path the frontend does.
//
// The HTTP wiring lives at the bottom in `ServerLive`: an `HttpRouter` with two
// `mountApp` calls, an explicit `Effect.catchTag("RouteNotFound", ...)`
// fallback, and transport-specific layers around the shared backend runtime.
//
// MENTAL MODEL REMINDERS
// ----------------------------------------------------------------------------
// - `Effect<A, E, R>` is a description; nothing runs until a runtime executes
//   it. `Layer<ROut, E, RIn>` is a description of how to construct the `R`
//   side. We compose layers to build the dependency graph and let the Bun
//   runtime resolve it.
// - `Layer.provide` is directional ("this needs that underneath"); `Layer.merge`
//   is parallel. The backend service graph lives in `runtime.ts`; this file adds
//   the HTTP transport and route mounts around it.
// - `Layer.launch` rather than `Effect.runPromise` because layers describe
//   long-lived resources; launch keeps the server alive for the lifetime of
//   the process. `BunRuntime.runMain` adds Bun-specific signal handling and
//   exit-code mapping.

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSwagger } from "effect/unstable/httpapi"
import { AppApi } from "@projectproject/shared"
import { count } from "drizzle-orm"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import { createHmac, timingSafeEqual } from "node:crypto"
import { projectIndex } from "./db/schema"
import { AttachmentsHandlerLive } from "./handlers/attachments"
import { attachmentRoutes } from "./http/attachmentRoutes"
import { AuthHandlerLive } from "./handlers/auth"
import { CommentsHandlerLive } from "./handlers/comments"
import { GroupsHandlerLive } from "./handlers/groups"
import { EverhourHandlerLive } from "./handlers/everhour"
import { OAuthApplicationsHandlerLive } from "./handlers/oauthApplications"
import { StorageHandlerLive } from "./handlers/storage"
import { OrgHandlerLive } from "./handlers/org"
import { ProjectsHandlerLive } from "./handlers/projects"
import { StatusesHandlerLive } from "./handlers/statuses"
import { TagsHandlerLive } from "./handlers/tags"
import { TicketsHandlerLive } from "./handlers/tickets"
import { McpHttp } from "./Services/McpHttp"
import { McpHttpLive } from "./Layers/McpHttp"
import { BackendHttpServicesLive, BackendInfrastructureLive } from "./runtime"
import { BetterAuth } from "./Services/BetterAuth"
import { Db } from "./Services/Db"
import { GitHubIntegrations } from "./Services/GitHubIntegrations"
import { GitHubWebhooks } from "./Services/GitHubWebhooks"
import { GitHubWebhooksLive } from "./Layers/GitHubWebhooks"
import { EverhourWebhooks } from "./Services/EverhourWebhooks"
import { EverhourWebhooksLive } from "./Layers/EverhourWebhooks"
import { McpServerLive } from "./Layers/McpServer"
import { TicketIndexReconcilerLive } from "./Layers/TicketIndexReconciler"
import { AttachmentReaperLive } from "./Layers/AttachmentReaper"

// Exported so tests can compose them without booting a real Bun server.
export const HealthHandlerLive = HttpApiBuilder.group(
  AppApi,
  "health",
  (handlers) =>
    handlers.handle("get", () => Effect.succeed({ status: "ok" as const }))
)

export const DbHandlerLive = HttpApiBuilder.group(AppApi, "db", (handlers) =>
  handlers.handle("ping", () =>
    Effect.gen(function* () {
      const db = yield* Db
      const [{ value }] = yield* db
        .select({ value: count() })
        .from(projectIndex)
      return { projectCount: value }
    }).pipe(Effect.orDie)
  )
)

const betterAuthApp = Effect.gen(function* () {
  const ba = yield* BetterAuth
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const webRes = yield* ba.handler(webReq)
  return HttpServerResponse.fromWeb(webRes)
}).pipe(
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("auth route failure", cause),
      Effect.succeed(HttpServerResponse.text("Auth error", { status: 500 }))
    )
  )
)

export const ApiLive = HttpApiBuilder.layer(AppApi).pipe(
  Layer.provide(HealthHandlerLive),
  Layer.provide(DbHandlerLive),
  Layer.provide(AuthHandlerLive),
  Layer.provide(OrgHandlerLive),
  Layer.provide(ProjectsHandlerLive),
  Layer.provide(EverhourHandlerLive),
  Layer.provide(TicketsHandlerLive),
  Layer.provide(CommentsHandlerLive),
  Layer.provide(TagsHandlerLive),
  Layer.provide(StatusesHandlerLive),
  Layer.provide(GroupsHandlerLive),
  Layer.provide(OAuthApplicationsHandlerLive),
  Layer.provide(StorageHandlerLive),
  Layer.provide(AttachmentsHandlerLive),
  Layer.provide(BackendHttpServicesLive)
)

// Swagger UI lives under /api/docs and reads /api/docs/swagger.json (the
// derived OpenAPI spec). Both are implemented by `HttpApiSwagger.layer({...})`,
// which we mount alongside our typed handlers in the same Layer chain — no
// extra mountApp call needed; the layer adds routes to the api group.
const SwaggerLive = HttpApiSwagger.layer(AppApi, { path: "/docs" })

// /mcp is mounted as an HttpRouter.all route so any HTTP method (POST for
// JSON-RPC, GET for SSE, DELETE for session teardown) reaches the SDK
// transport. We bridge by converting the Effect-platform request to a Web
// standard Request, delegating to the McpHttp handler, and translating its
// Response back into an HttpServerResponse via fromWeb.
const mcpRoute = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const mcpHttp = yield* McpHttp
  const webReq = yield* HttpServerRequest.toWeb(req)
  const webRes = yield* Effect.promise(() => mcpHttp.handle(webReq))
  return HttpServerResponse.fromWeb(webRes)
}).pipe(
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("mcp route failure", cause),
      Effect.succeed(HttpServerResponse.text("MCP error", { status: 500 }))
    )
  )
)

const badRequest = (message: string) =>
  HttpServerResponse.text(message, { status: 400 })

const githubSetupRoute = Effect.gen(function* () {
  const integrations = yield* GitHubIntegrations
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const url = new URL(webReq.url)
  const state = url.searchParams.get("state")
  const installationId = url.searchParams.get("installation_id")
  if (!state || !installationId) return badRequest("Missing GitHub setup state")
  const { authorizeUrl } = yield* integrations.completeSetup(
    state,
    installationId
  )
  return HttpServerResponse.redirect(authorizeUrl)
}).pipe(
  Effect.catchTags({
    NotFound: () =>
      Effect.succeed(
        HttpServerResponse.text("GitHub setup expired", { status: 404 })
      ),
    GitHubError: () =>
      Effect.succeed(
        HttpServerResponse.text("GitHub setup failed", { status: 500 })
      )
  }),
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("github setup route failure", cause),
      Effect.succeed(
        HttpServerResponse.text("GitHub setup failed", { status: 500 })
      )
    )
  )
)

const githubCallbackRoute = Effect.gen(function* () {
  const integrations = yield* GitHubIntegrations
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const url = new URL(webReq.url)
  const state = url.searchParams.get("state")
  const code = url.searchParams.get("code")
  if (!state || !code) return badRequest("Missing GitHub callback state")
  const { redirectUrl } = yield* integrations.completeCallback(state, code)
  return HttpServerResponse.redirect(redirectUrl)
}).pipe(
  Effect.catchTags({
    NotFound: () =>
      Effect.succeed(
        HttpServerResponse.text("GitHub callback expired", { status: 404 })
      ),
    Forbidden: () =>
      Effect.succeed(
        HttpServerResponse.text("GitHub installation was not verified", {
          status: 403
        })
      ),
    GitHubError: () =>
      Effect.succeed(
        HttpServerResponse.text("GitHub callback failed", { status: 500 })
      )
  }),
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("github callback route failure", cause),
      Effect.succeed(
        HttpServerResponse.text("GitHub callback failed", { status: 500 })
      )
    )
  )
)

export const verifyGithubWebhook = (
  body: string,
  signature: string | null,
  secret: string
) => {
  if (!signature?.startsWith("sha256=")) return false
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  )
}

export const GITHUB_WEBHOOK_MAX_BODY_BYTES = 25 * 1024 * 1024

class GithubWebhookBodyTooLarge extends Data.TaggedError(
  "GithubWebhookBodyTooLarge"
)<{}> {}

class GithubWebhookBodyReadError extends Data.TaggedError(
  "GithubWebhookBodyReadError"
)<{ readonly cause: unknown }> {}

export const readGithubWebhookBody = (
  webReq: Request,
  maxBytes = GITHUB_WEBHOOK_MAX_BODY_BYTES
) =>
  Effect.tryPromise({
    try: async () => {
      const lengthHeader = webReq.headers.get("content-length")
      const contentLength = lengthHeader === null ? null : Number(lengthHeader)
      if (
        contentLength !== null &&
        Number.isFinite(contentLength) &&
        contentLength > maxBytes
      ) {
        throw new GithubWebhookBodyTooLarge()
      }

      const reader = webReq.body?.getReader()
      if (!reader) return ""

      const decoder = new TextDecoder()
      const chunks: Array<string> = []
      let bytes = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > maxBytes) {
          await reader.cancel()
          throw new GithubWebhookBodyTooLarge()
        }
        chunks.push(decoder.decode(value, { stream: true }))
      }

      chunks.push(decoder.decode())
      return chunks.join("")
    },
    catch: (cause) =>
      cause instanceof GithubWebhookBodyTooLarge
        ? cause
        : new GithubWebhookBodyReadError({ cause })
  })

export const githubWebhookRoute = Effect.gen(function* () {
  const webhooks = yield* GitHubWebhooks
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const body = yield* readGithubWebhookBody(webReq).pipe(
    Effect.catchTag("GithubWebhookBodyTooLarge", () => Effect.succeed(null))
  )
  if (body === null) {
    return HttpServerResponse.text("GitHub webhook payload too large", {
      status: 413
    })
  }
  const secret = yield* Config.redacted("GITHUB_APP_WEBHOOK_SECRET")
  const verified = verifyGithubWebhook(
    body,
    webReq.headers.get("x-hub-signature-256"),
    Redacted.value(secret)
  )
  if (!verified) {
    return HttpServerResponse.text("Invalid signature", { status: 401 })
  }
  const event = webReq.headers.get("x-github-event")
  if (!event) {
    return badRequest("Missing GitHub event")
  }
  yield* webhooks.handle({
    event,
    deliveryId: webReq.headers.get("x-github-delivery"),
    body
  })
  return HttpServerResponse.text("ok")
}).pipe(
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("github webhook route failure", cause),
      Effect.succeed(
        HttpServerResponse.text("GitHub webhook failed", { status: 500 })
      )
    )
  )
)

const githubIntegrationRoutes = HttpRouter.addAll(
  [
    HttpRouter.route("GET", "/setup", githubSetupRoute),
    HttpRouter.route("GET", "/callback", githubCallbackRoute),
    HttpRouter.route("POST", "/webhook", githubWebhookRoute)
  ],
  { prefix: "/api/integrations/github" }
)

export const everhourWebhookRoute = Effect.gen(function* () {
  const webhooks = yield* EverhourWebhooks
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const url = new URL(webReq.url)
  const match = url.pathname.match(/\/webhook\/([^/]+)\/?$/)
  const secret = match?.[1] ? decodeURIComponent(match[1]) : null
  if (!secret) return badRequest("Missing webhook secret")
  const body = yield* Effect.promise(() => webReq.text().catch(() => ""))
  yield* webhooks.handle({ secret, body })
  return HttpServerResponse.text("ok")
}).pipe(
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("everhour webhook route failure", cause),
      Effect.succeed(HttpServerResponse.text("ok"))
    )
  )
)

const everhourIntegrationRoutes = HttpRouter.add(
  "POST",
  "/api/integrations/everhour/webhook/:secret",
  everhourWebhookRoute
)

const RouteLive = Layer.mergeAll(
  HttpRouter.add("*", "/api/auth/*", betterAuthApp),
  HttpRouter.add("*", "/.well-known/*", betterAuthApp),
  githubIntegrationRoutes,
  everhourIntegrationRoutes,
  HttpRouter.add(
    "GET",
    "/api/attachments/:orgSlug/:attachmentId",
    attachmentRoutes
  ),
  HttpRouter.add("*", "/mcp", mcpRoute),
  ApiLive,
  SwaggerLive
)

const ServerLive = HttpRouter.serve(RouteLive).pipe(
  Layer.provide(McpHttpLive),
  Layer.provide(McpServerLive),
  Layer.provide(GitHubWebhooksLive),
  Layer.provide(EverhourWebhooksLive),
  Layer.provide(BackendHttpServicesLive),
  Layer.provide(BackendInfrastructureLive)
)

const ReconcilerLive = TicketIndexReconcilerLive.pipe(
  Layer.provide(BackendHttpServicesLive),
  Layer.provide(BackendInfrastructureLive)
)

const ReaperLive = AttachmentReaperLive.pipe(
  Layer.provide(BackendHttpServicesLive),
  Layer.provide(BackendInfrastructureLive)
)

const AppLive = Layer.mergeAll(ServerLive, ReconcilerLive, ReaperLive)

// Only boot the real server when this file is the entry point. When tests
// import { ApiLive } from this module, `import.meta.main` is false and we
// skip the bind. (Bun-specific — Node has no equivalent built-in, but we're
// running on Bun.)
if (import.meta.main) {
  const BunHttpServer = await import("@effect/platform-bun/BunHttpServer")
  const BunRuntime = await import("@effect/platform-bun/BunRuntime")
  BunRuntime.runMain(
    Layer.launch(
      AppLive.pipe(Layer.provide(BunHttpServer.layer({ port: 3000 })))
    )
  )
}

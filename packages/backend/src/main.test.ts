// packages/backend/src/main.test.ts
//
// Chapter 0 — backend handler tests.
// ============================================================================
// First test (the one you wrote): asserts the happy path of `health.get`.
// Below it, three extra tests fill out the coverage you'll lean on in later
// chapters:
//
//   - the Content-Type header is JSON (the schema-driven serialization story)
//   - an unknown route returns 404 (proves the router is wired, not just the
//     one handler)
//   - `HttpApiClient.make(AppApi)` against an in-process transport (the spec's
//     recommended pattern — same client the frontend uses, full type-checked,
//     no string URLs in tests)
//
// All four tests share one `toWebHandler` instance for speed. In Chapter 2+
// where handlers depend on services with state (Db, Markdown), you'll build a
// fresh handler per test (or per file) so layers don't leak between cases.
//
// HOW WE TEST WITHOUT A REAL SERVER
// ----------------------------------------------------------------------------
// `HttpApiBuilder.toWebHandler` turns an API layer into a plain
// `(request: Request) => Promise<Response>` function. No port binding, no
// network — the full Effect pipeline runs in-process. The catch is that the
// returned function isn't enough on its own: `toWebHandler` requires the
// layer to provide `HttpApi.Api` AND `HttpServer.layerContext` (the default
// HttpRouter services that `BunHttpServer.layer` would normally bundle in).
// We merge them in below.
//
// THE IN-PROCESS CLIENT TRICK
// ----------------------------------------------------------------------------
// `HttpApiClient.make(AppApi)` builds a client that calls a service named
// `FetchHttpClient.Fetch` to do its actual HTTP. By default that service is
// the global `fetch`. In tests we swap it for a function that calls our
// `toWebHandler` directly, so a `client.health.get()` call inside the test
// dispatches to our in-memory handler with no network hop. Same client API
// the frontend uses; same types; full contract enforcement.

import { it } from "@effect/vitest"
import {
  FetchHttpClient,
  HttpApi,
  HttpApp,
  HttpApiBuilder,
  HttpApiClient,
  HttpServer
} from "@effect/platform"
import { AppApi } from "@projectproject/shared"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { afterAll, expect } from "vite-plus/test"
import { createHmac } from "node:crypto"
import {
  GITHUB_WEBHOOK_MAX_BODY_BYTES,
  HealthHandlerLive,
  githubWebhookRoute,
  readGithubWebhookBody,
  verifyGithubWebhook
} from "./main"
import {
  GitHubWebhooks,
  type GitHubWebhooksShape
} from "./Services/GitHubWebhooks"

const healthGroup = Object.values(AppApi.groups).find(
  (group) => group.identifier === "health"
)
if (!healthGroup) throw new Error("Health API group not found")

const ApiUnderTestLive = HttpApiBuilder.api(
  HttpApi.make(AppApi.identifier).add(healthGroup)
).pipe(Layer.provide(HealthHandlerLive))

// One shared web handler for the whole suite.
const { handler, dispose } = HttpApiBuilder.toWebHandler(
  ApiUnderTestLive.pipe(Layer.provideMerge(HttpServer.layerContext))
)

afterAll(() => dispose())

// Layer that lets `HttpApiClient.make(AppApi)` reach our in-process handler
// instead of the network. We override the `FetchHttpClient.Fetch` service —
// the seam through which `FetchHttpClient.layer` makes its requests.
const InProcessFetch = Layer.succeed(FetchHttpClient.Fetch, ((input, init) =>
  handler(
    input instanceof Request ? input : new Request(String(input), init)
  )) as typeof fetch)
const TestHttpClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(InProcessFetch)
)

// ----------------------------------------------------------------------------
// 1. The test you wrote: happy path through the raw web handler.
// ----------------------------------------------------------------------------

it.effect("GET /health responds with { status: 'ok' } and a 200", () =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      handler(new Request("http://localhost/health"))
    )

    expect(response.status).toBe(200)

    const body = yield* Effect.promise(() => response.json())
    expect(body).toEqual({ status: "ok" })
  })
)

// ----------------------------------------------------------------------------
// 2. Content-Type header. Cheap, but verifies the schema-driven serializer
//    actually runs — a misconfigured handler that returned plain text would
//    pass the body check but fail this one.
// ----------------------------------------------------------------------------

it.effect("GET /health sets Content-Type to JSON", () =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      handler(new Request("http://localhost/health"))
    )

    // The platform sets `application/json` with charset/profile suffixes
    // depending on version, so don't assert exact equality — just match the
    // type prefix.
    expect(response.headers.get("content-type")).toMatch(/^application\/json/)
  })
)

// ----------------------------------------------------------------------------
// 3. Unknown route. Proves the router rejects what it doesn't know about,
//    rather than (e.g.) returning 200 with the only handler we've defined.
// ----------------------------------------------------------------------------

it.effect("GET /unknown returns 404", () =>
  Effect.gen(function* () {
    const response = yield* Effect.promise(() =>
      handler(new Request("http://localhost/unknown"))
    )

    expect(response.status).toBe(404)
  })
)

// ----------------------------------------------------------------------------
// 4. Same endpoint, exercised through the typed `HttpApiClient` — the pattern
//    you'll use for all real integration tests from Chapter 2 onward.
//
//    Notice what we DON'T write here:
//      - no string URL ("/health")
//      - no manual JSON parsing
//      - no manual status-code handling
//    The contract carries everything. Add `.addError(NotFound)` to the
//    endpoint and this test would suddenly have to discriminate the success
//    and error branches via the Effect's `E` channel — the type system
//    forcing the test to keep up with the contract.
// ----------------------------------------------------------------------------

it.effect("HttpApiClient.health.get() returns { status: 'ok' }", () =>
  Effect.gen(function* () {
    const client = yield* HttpApiClient.make(AppApi, {
      baseUrl: "http://localhost"
    })
    const result = yield* client.health.get()

    expect(result).toEqual({ status: "ok" })
  }).pipe(Effect.provide(TestHttpClientLayer))
)

const webhookSecret = "test-webhook-secret"
const jsonBody = (value: unknown) =>
  Schema.encodeSync(Schema.parseJson())(value)

const signWebhookBody = (body: string) =>
  `sha256=${createHmac("sha256", webhookSecret).update(body).digest("hex")}`

const makeWebhookHandler = (service: GitHubWebhooksShape) =>
  HttpApp.toWebHandlerLayer(
    githubWebhookRoute.pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([["GITHUB_APP_WEBHOOK_SECRET", webhookSecret]])
        )
      )
    ),
    Layer.succeed(GitHubWebhooks, service)
  )

it("verifyGithubWebhook accepts the matching sha256 signature", () => {
  const body = jsonBody({ action: "ping" })
  expect(verifyGithubWebhook(body, signWebhookBody(body), webhookSecret)).toBe(
    true
  )
  expect(verifyGithubWebhook(body, "sha256=bad", webhookSecret)).toBe(false)
})

it.effect(
  "readGithubWebhookBody fails when the stream exceeds the byte limit",
  () =>
    Effect.gen(function* () {
      const result = yield* readGithubWebhookBody(
        new Request("http://localhost/api/integrations/github/webhook", {
          method: "POST",
          body: "abcd"
        }),
        3
      ).pipe(Effect.either)

      expect(result._tag).toBe("Left")
    })
)

it.effect(
  "github webhook route rejects bodies over the GitHub delivery limit",
  () =>
    Effect.promise(async () => {
      const { handler, dispose } = makeWebhookHandler({
        handle: () => Effect.void
      })
      try {
        const response = await handler(
          new Request("http://localhost/api/integrations/github/webhook", {
            method: "POST",
            body: "{}",
            headers: {
              "content-length": String(GITHUB_WEBHOOK_MAX_BODY_BYTES + 1),
              "x-hub-signature-256": "sha256=bad",
              "x-github-event": "installation"
            }
          })
        )
        expect(response.status).toBe(413)
        expect(await response.text()).toBe("GitHub webhook payload too large")
      } finally {
        await dispose()
      }
    })
)

it.effect("github webhook route rejects invalid signatures", () =>
  Effect.promise(async () => {
    const { handler, dispose } = makeWebhookHandler({
      handle: () => Effect.void
    })
    try {
      const response = await handler(
        new Request("http://localhost/api/integrations/github/webhook", {
          method: "POST",
          body: "{}",
          headers: {
            "x-hub-signature-256": "sha256=bad",
            "x-github-event": "installation"
          }
        })
      )
      expect(response.status).toBe(401)
      expect(await response.text()).toBe("Invalid signature")
    } finally {
      await dispose()
    }
  })
)

it.effect("github webhook route requires the event header", () =>
  Effect.promise(async () => {
    const body = "{}"
    const { handler, dispose } = makeWebhookHandler({
      handle: () => Effect.void
    })
    try {
      const response = await handler(
        new Request("http://localhost/api/integrations/github/webhook", {
          method: "POST",
          body,
          headers: {
            "x-hub-signature-256": signWebhookBody(body)
          }
        })
      )
      expect(response.status).toBe(400)
      expect(await response.text()).toBe("Missing GitHub event")
    } finally {
      await dispose()
    }
  })
)

it.effect("github webhook route dispatches signed deliveries", () =>
  Effect.promise(async () => {
    const body = jsonBody({ action: "deleted", installation: { id: 123 } })
    const deliveries: Array<{
      event: string
      deliveryId: string | null
      body: string
    }> = []
    const { handler, dispose } = makeWebhookHandler({
      handle: (delivery) =>
        Effect.sync(() => {
          deliveries.push(delivery)
        })
    })
    try {
      const response = await handler(
        new Request("http://localhost/api/integrations/github/webhook", {
          method: "POST",
          body,
          headers: {
            "x-hub-signature-256": signWebhookBody(body),
            "x-github-event": "installation",
            "x-github-delivery": "delivery-1"
          }
        })
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("ok")
      expect(deliveries).toEqual([
        { event: "installation", deliveryId: "delivery-1", body }
      ])
    } finally {
      await dispose()
    }
  })
)

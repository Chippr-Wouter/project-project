// packages/frontend/src/services/ApiClient.ts
//
// THE TYPED CLIENT, DERIVED FROM THE SHARED CONTRACT.
// ----------------------------------------------------------------------------
// `HttpApiClient.make(AppApi)` reads the shared API definition (the same
// `AppApi` value the backend implements) and returns a fully typed client.
// `client.health.get()` is autocompleted, the response type is inferred,
// and any errors you declared with `.addError(...)` show up in the Effect's
// `E` channel. There is no codegen step — this is straight TypeScript.
//
// We expose the client as a *service*, so:
//   1. The HTTP transport (FetchHttpClient) is itself a layer the client
//      needs underneath it; expressing it as a service dependency keeps that
//      wiring explicit and testable.
//   2. In tests, we can swap the live implementation for a fake one without
//      touching component code. This is the entire pitch of Effect's
//      dependency injection.
//
// PATTERN: `Effect.Service` (modern, Effect v3.9+)
// ----------------------------------------------------------------------------
// `Effect.Service` is a helper that bundles three things you'd otherwise hand-
// write separately:
//   - the Tag (the identity of the service in the `R` channel)
//   - the Layer (how to construct it)
//   - the *type* of the service (inferred from the `effect:` field — you
//     don't have to spell it out)
//
// You'll also see the older `Context.Tag` + `Layer.effect` pattern in the
// wild and in our own `Markdown`/`Projects`/`Tickets` services later. For
// services that wrap an external library (like `HttpApiClient`), the
// inference `Effect.Service` gives you is a real win — you'd otherwise have
// to extract type parameters from `HttpApi` by hand.
//
// CHAPTER 0 STEPS
// ----------------------------------------------------------------------------
//   1. Imports:
//        import { Effect } from "effect"
//        import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
//        import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
//        import { AppApi } from "@projectproject/shared"
//
//   2. Declare the service in one shot:
//        export class ApiClient extends Effect.Service<ApiClient>()(
//          "ApiClient",
//          {
//            effect: HttpApiClient.make(AppApi, { baseUrl: "/api" }),
//            dependencies: [FetchHttpClient.layer]
//          }
//        ) {}
//
// WHAT YOU GET
// ----------------------------------------------------------------------------
// - `ApiClient` (the class itself) is the Tag — `yield* ApiClient` works.
// - `ApiClient.Default` is the live Layer — what you provide in routes/tests.
// - The service shape is the success type of the `effect:` Effect — i.e. the
//   typed `client` returned by `HttpApiClient.make(AppApi, ...)`. So
//   `client.health.get()` autocompletes with no extra type machinery.
//
// You are *describing* how to build an ApiClient — not building one yet. The
// first call to `Effect.runPromise(program.pipe(Effect.provide(ApiClient.Default)))`
// is when the layer is actually constructed.

import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
import { AppApi } from "@projectproject/shared"

export class ApiClient extends Context.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof AppApi>
>()("@projectproject/frontend/services/ApiClient") {
  static readonly Default = Layer.effect(
    ApiClient,
    HttpApiClient.make(AppApi, { baseUrl: "/api" }).pipe(
      Effect.provide(FetchHttpClient.layer)
    )
  )
}

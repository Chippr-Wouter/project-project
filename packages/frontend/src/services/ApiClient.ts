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
      Effect.provide(
        Layer.provide(
          FetchHttpClient.layer,
          Layer.succeed(FetchHttpClient.Fetch, ((request, init) =>
            globalThis.fetch(request, init)) as typeof globalThis.fetch)
        )
      )
    )
  )
}

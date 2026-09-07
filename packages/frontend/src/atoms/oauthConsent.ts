import * as Atom from "effect/unstable/reactivity/Atom"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import { authClient } from "@/services/AuthClient"

export interface SubmitConsentInput {
  readonly accept: boolean
  readonly oauthQuery: string
}

export const submitConsentAtom = Atom.family((oauthQuery: string) =>
  runtime.fn(
    Effect.fn(function* (input: SubmitConsentInput) {
      const client = yield* ApiClient
      return yield* client.oauthApplications.consent({
        payload: {
          accept: input.accept,
          oauth_query: oauthQuery
        }
      })
    })
  )
)

const OAuthClientName = Schema.Struct({
  client_name: Schema.optional(Schema.NullOr(Schema.String))
})

export const oauthClientNameAtom = Atom.family((clientId: string) =>
  runtime
    .atom(
      Effect.gen(function* () {
        if (!clientId) return null
        const { data, error } = yield* Effect.tryPromise(() =>
          authClient.$fetch<unknown>("/oauth2/public-client", {
            query: { client_id: clientId }
          })
        )
        if (error) return yield* Effect.fail(error)
        const client = yield* Schema.decodeUnknownEffect(OAuthClientName)(data)
        return client.client_name?.trim() || null
      })
    )
    .pipe(Atom.setIdleTTL("2 minutes"))
)

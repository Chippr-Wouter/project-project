import { Atom } from "@effect-atom/atom-react"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"

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

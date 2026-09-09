import { expect, it } from "vite-plus/test"
import { APIError } from "better-auth/api"
import { Effect } from "effect"
import { BetterAuthError } from "../Services/BetterAuth"
import { consentErrorToFailure } from "./oauthApplications"

it("preserves the OAuth error code for invalid or expired consent queries", async () => {
  const error = new BetterAuthError({
    cause: new APIError("BAD_REQUEST", { error: "invalid_signature" })
  })
  const result = await Effect.runPromise(
    consentErrorToFailure(error).pipe(Effect.flip)
  )
  expect(result).toMatchObject({
    _tag: "Validation",
    reason: "invalid_signature"
  })
})

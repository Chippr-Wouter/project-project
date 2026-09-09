import * as Config from "effect/Config"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "octokit"
import { GitHubError } from "@projectproject/shared"
import { GITHUB_REQUEST_TIMEOUT } from "./request"

export type GitHubAppAuth = ReturnType<typeof createAppAuth>

export const fetchWithTimeout = (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> => {
  const timeoutSignal = AbortSignal.timeout(
    Duration.toMillis(GITHUB_REQUEST_TIMEOUT)
  )
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal
  return globalThis.fetch(input, { ...init, signal })
}

const githubAuthRequest = new Octokit({
  retry: { enabled: false }
}).request.defaults({
  request: { fetch: fetchWithTimeout }
})

const normalizePrivateKey = (raw: string): string => {
  const normalized = raw.replace(/\\n/g, "\n")
  if (normalized.includes("BEGIN")) return normalized
  return Buffer.from(normalized, "base64").toString("utf8")
}

export const appAuth = (): Effect.Effect<GitHubAppAuth, GitHubError> =>
  Effect.gen(function* () {
    const appId = yield* Config.string("GITHUB_APP_ID")
    const privateKey = yield* Config.redacted("GITHUB_APP_PRIVATE_KEY")
    const clientId = yield* Config.string("GITHUB_APP_CLIENT_ID")
    const clientSecret = yield* Config.redacted("GITHUB_APP_CLIENT_SECRET")
    return yield* Effect.try({
      try: () =>
        createAppAuth({
          appId,
          privateKey: normalizePrivateKey(Redacted.value(privateKey)),
          clientId,
          clientSecret: Redacted.value(clientSecret),
          request: githubAuthRequest
        }),
      catch: (cause) => new GitHubError({ message: String(cause) })
    })
  }).pipe(
    Effect.catch((cause) =>
      cause._tag === "GitHubError"
        ? Effect.fail(cause)
        : Effect.fail(
            new GitHubError({
              message: "missing GitHub App configuration"
            })
          )
    )
  )

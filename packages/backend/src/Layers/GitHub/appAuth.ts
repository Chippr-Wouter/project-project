import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { createAppAuth } from "@octokit/auth-app"
import { GitHubError } from "@projectproject/shared"

export type GitHubAppAuth = ReturnType<typeof createAppAuth>

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
          clientSecret: Redacted.value(clientSecret)
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

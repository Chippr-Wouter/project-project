import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { RateLimited } from "@projectproject/shared"
import { mapHttpError, type GitHubFailure, type TaggedFailure } from "./errors"

export const GITHUB_REQUEST_TIMEOUT = Duration.seconds(15)

export type GitHubRequestAttributes = Record<string, unknown> & {
  readonly tokenSource: "app" | "user" | "installation"
  readonly operation: string
  readonly scopeKey?: string
  readonly installationId?: string
  readonly userId?: string
}

const MAX_COOLDOWNS = 256

type RawRequestFailure = {
  readonly cause: unknown
}

const cooldownKey = (attributes: GitHubRequestAttributes): string =>
  attributes.tokenSource === "app"
    ? "app"
    : `${attributes.tokenSource}:${
        attributes.scopeKey ??
        attributes.installationId ??
        attributes.userId ??
        attributes.tokenSource
      }`

export class GitHubRequestState extends Context.Service<
  GitHubRequestState,
  {
    readonly pausedUntil: (
      key: string,
      nowMillis: number
    ) => Effect.Effect<number | undefined>
    readonly rememberRateLimit: (
      key: string,
      error: GitHubFailure
    ) => Effect.Effect<void>
  }
>()("@projectproject/backend/Layers/GitHub/request/GitHubRequestState") {}

export const make = (): GitHubRequestState["Service"] => {
  const cooldowns = new Map<string, number>()

  const pausedUntil = (key: string, nowMillis: number) =>
    Effect.sync(() => {
      const value = cooldowns.get(key)
      if (value !== undefined && value <= nowMillis) {
        cooldowns.delete(key)
        return undefined
      }
      return value
    })
  const rememberRateLimit = (key: string, error: GitHubFailure) =>
    Effect.sync(() => {
      if (error._tag !== "RateLimited") return
      const resetAt = error.resetAt
      if (!Number.isFinite(resetAt)) return
      const retryAt = resetAt * 1000
      const previous = cooldowns.get(key)
      if (previous !== undefined && previous >= retryAt) return
      if (cooldowns.size >= MAX_COOLDOWNS && previous === undefined) {
        const first = cooldowns.keys().next().value
        if (first !== undefined) cooldowns.delete(first)
      }
      cooldowns.set(key, retryAt)
    })
  return GitHubRequestState.of({ pausedUntil, rememberRateLimit })
}

export const layer = Layer.sync(GitHubRequestState, make)

const telemetryAttributeKeys = [
  "tokenSource",
  "operation",
  "installationId",
  "repoOwner",
  "repoName",
  "page",
  "first",
  "branches"
] as const

const telemetryAttributes = (
  attributes: GitHubRequestAttributes
): Record<string, unknown> =>
  Object.fromEntries(
    telemetryAttributeKeys.flatMap((key) =>
      key in attributes ? [[key, attributes[key]]] : []
    )
  )

export const githubRequest = <A, EOut extends TaggedFailure>(
  attributes: GitHubRequestAttributes,
  fn: (signal: AbortSignal) => Promise<A>,
  narrowErr: (cause: unknown, now: number) => EOut
): Effect.Effect<A, EOut | RateLimited, GitHubRequestState> => {
  const safeAttributes = telemetryAttributes(attributes)
  const key = cooldownKey(attributes)
  return Effect.gen(function* () {
    const state = yield* GitHubRequestState
    const nowMillis = yield* Clock.currentTimeMillis
    const now = Math.floor(nowMillis / 1000)
    const pausedUntil = yield* state.pausedUntil(key, nowMillis)
    if (pausedUntil !== undefined && pausedUntil > nowMillis) {
      return yield* new RateLimited({
        resetAt: Math.ceil(pausedUntil / 1000)
      })
    }
    const result = yield* Effect.timeoutOption(
      Effect.tryPromise({
        try: fn,
        catch: (cause): RawRequestFailure => ({ cause })
      }).pipe(
        Effect.tapError((failure) =>
          state.rememberRateLimit(key, mapHttpError(failure.cause, now))
        ),
        Effect.mapError((failure) => narrowErr(failure.cause, now))
      ),
      GITHUB_REQUEST_TIMEOUT
    )
    if (Option.isSome(result)) return result.value
    const timeoutError = narrowErr(
      new Error(
        `GitHub request timed out after ${Duration.toMillis(GITHUB_REQUEST_TIMEOUT)}ms`
      ),
      now
    )
    return yield* Effect.fail(timeoutError)
  }).pipe(
    Effect.tapError((error) =>
      Effect.logWarning("github request failed").pipe(
        Effect.annotateLogs({ error: error._tag })
      )
    ),
    Effect.withSpan(`GitHub.${attributes.operation}`, {
      attributes: safeAttributes
    }),
    Effect.annotateLogs({ module: "GitHub", ...safeAttributes })
  )
}

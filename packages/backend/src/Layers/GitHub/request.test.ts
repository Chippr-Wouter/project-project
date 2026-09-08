import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import { expect } from "vite-plus/test"
import { GitHubError } from "@projectproject/shared"
import { GITHUB_REQUEST_TIMEOUT, githubRequest } from "./request"
import * as GitHubRequestState from "./request"
import { mapHttpError, narrow } from "./errors"

const attributes = {
  tokenSource: "user" as const,
  operation: "test"
}

it.effect("aborts a request that exceeds the timeout", () =>
  Effect.gen(function* () {
    let aborted = false
    const fiber = yield* githubRequest(
      attributes,
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            aborted = true
            reject(new Error("aborted"))
          })
        }),
      (cause) => new GitHubError({ message: String(cause) })
    ).pipe(Effect.forkChild)

    yield* TestClock.adjust(GITHUB_REQUEST_TIMEOUT)
    const error = yield* Fiber.join(fiber).pipe(Effect.flip)

    expect(aborted).toBe(true)
    expect(error._tag).toBe("GitHubError")
    expect(error.message).toContain("timed out")
  }).pipe(Effect.provide(GitHubRequestState.layer))
)

it.effect(
  "pauses repeated requests after a rate limit without sharing users",
  () =>
    Effect.gen(function* () {
      const cause = {
        status: 429,
        response: {
          status: 429,
          headers: { "x-ratelimit-reset": "4102444800" }
        }
      }
      const limitedAttributes = {
        ...attributes,
        scopeKey: "rate-limit-user-a"
      }
      const otherAttributes = {
        ...attributes,
        scopeKey: "rate-limit-user-b"
      }
      const first = yield* githubRequest(
        limitedAttributes,
        () => Promise.reject(cause),
        mapHttpError
      ).pipe(Effect.flip)
      expect(first._tag).toBe("RateLimited")

      let otherCalls = 0
      const other = yield* githubRequest(
        otherAttributes,
        () => {
          otherCalls += 1
          return Promise.resolve("ok")
        },
        mapHttpError
      )
      expect(other).toBe("ok")
      expect(otherCalls).toBe(1)

      let blockedCalls = 0
      const blocked = yield* githubRequest(
        limitedAttributes,
        () => {
          blockedCalls += 1
          return Promise.resolve("unexpected")
        },
        mapHttpError
      ).pipe(Effect.flip)
      expect(blocked._tag).toBe("RateLimited")
      expect(blockedCalls).toBe(0)
    }).pipe(Effect.provide(GitHubRequestState.layer))
)

it.effect("isolates cooldown state between service layers", () =>
  Effect.gen(function* () {
    const cause = {
      status: 429,
      response: {
        status: 429,
        headers: { "x-ratelimit-reset": "4102444800" }
      }
    }
    const scoped = {
      ...attributes,
      scopeKey: "isolated-cooldown"
    }
    yield* githubRequest(
      scoped,
      () => Promise.reject(cause),
      mapHttpError
    ).pipe(Effect.flip, Effect.provide(GitHubRequestState.layer))
    let calls = 0
    const result = yield* githubRequest(
      scoped,
      () => {
        calls += 1
        return Promise.resolve("ok")
      },
      mapHttpError
    ).pipe(Effect.provide(GitHubRequestState.layer))

    expect(result).toBe("ok")
    expect(calls).toBe(1)
  })
)

it.effect("preserves rate limits through narrowing and cooldowns", () =>
  Effect.gen(function* () {
    const cause = {
      status: 429,
      response: {
        status: 429,
        headers: { "x-ratelimit-reset": "30" }
      }
    }
    const scoped = {
      ...attributes,
      scopeKey: "mapped-rate-limit"
    }
    const narrowRateLimit = narrow(["RepoGone"] as const)
    const first = yield* githubRequest(
      scoped,
      () => Promise.reject(cause),
      narrowRateLimit
    ).pipe(Effect.flip)
    expect(first._tag).toBe("RateLimited")

    let calls = 0
    const blocked = yield* githubRequest(
      scoped,
      () => {
        calls += 1
        return Promise.resolve("unexpected")
      },
      narrowRateLimit
    ).pipe(Effect.flip)
    expect(blocked._tag).toBe("RateLimited")
    expect(calls).toBe(0)

    yield* TestClock.adjust(31_000)
    const recovered = yield* githubRequest(
      scoped,
      () => {
        calls += 1
        return Promise.resolve("ok")
      },
      narrowRateLimit
    )
    expect(recovered).toBe("ok")
    expect(calls).toBe(1)
  }).pipe(Effect.provide(GitHubRequestState.layer))
)

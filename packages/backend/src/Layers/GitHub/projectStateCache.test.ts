import { it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as TestClock from "effect/testing/TestClock"
import { GitHubError, RateLimited, RepoGone } from "@projectproject/shared"
import { expect } from "vite-plus/test"
import * as ProjectStateCache from "./projectStateCache"

const snapshot = {
  defaultBranch: "main",
  existingBranches: new Set<string>(["feat/T-1"]),
  prByBranch: new Map()
}

const keyFor = (suffix: string) =>
  ProjectStateCache.projectStateCacheKey(
    "installation",
    "acme",
    `app-${suffix}`,
    [],
    undefined
  )

it.effect("deduplicates in-flight project state reads", () =>
  Effect.gen(function* () {
    const cache = yield* ProjectStateCache.ProjectStateCache
    const started = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let calls = 0
    const { key, repoKey } = keyFor("dedupe")
    const fetch = Effect.gen(function* () {
      calls += 1
      yield* Deferred.succeed(started, undefined)
      yield* Deferred.await(release)
      return snapshot
    })

    const first = yield* cache
      .cachedProjectStates(key, "installation", repoKey, fetch)
      .pipe(Effect.forkChild)
    yield* Deferred.await(started)
    const second = yield* cache
      .cachedProjectStates(key, "installation", repoKey, fetch)
      .pipe(Effect.forkChild)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(first)
    yield* Fiber.join(second)

    expect(calls).toBe(1)
  }).pipe(Effect.provide(ProjectStateCache.layer))
)

it.effect("isolates cache state between service layers", () =>
  Effect.gen(function* () {
    let calls = 0
    const { key, repoKey } = keyFor("isolated")
    const fetch = Effect.sync(() => {
      calls += 1
      return snapshot
    })
    const read = Effect.gen(function* () {
      const cache = yield* ProjectStateCache.ProjectStateCache
      return yield* cache.cachedProjectStates(
        key,
        "installation",
        repoKey,
        fetch
      )
    })

    yield* read.pipe(Effect.provide(ProjectStateCache.layer))
    yield* read.pipe(Effect.provide(ProjectStateCache.layer))

    expect(calls).toBe(2)
  })
)

it.effect(
  "expires successful project state reads without caching failures",
  () =>
    Effect.gen(function* () {
      let calls = 0
      const cache = yield* ProjectStateCache.ProjectStateCache
      const { key, repoKey } = keyFor("expiry")
      const fetch = Effect.sync(() => {
        calls += 1
        return snapshot
      })

      yield* cache.cachedProjectStates(key, "installation", repoKey, fetch)
      yield* cache.cachedProjectStates(key, "installation", repoKey, fetch)
      expect(calls).toBe(1)

      yield* TestClock.adjust(Duration.seconds(16))
      yield* cache.cachedProjectStates(key, "installation", repoKey, fetch)
      expect(calls).toBe(2)
    }).pipe(Effect.provide(ProjectStateCache.layer))
)

it.effect(
  "returns the last snapshot for a rate-limited refresh and retries next time",
  () =>
    Effect.gen(function* () {
      const cache = yield* ProjectStateCache.ProjectStateCache
      let shouldFail = false
      let calls = 0
      const { key, repoKey } = keyFor("stale")
      const fetch = Effect.gen(function* () {
        calls += 1
        if (shouldFail) return yield* new RateLimited({ resetAt: 1234 })
        return snapshot
      })

      yield* cache.cachedProjectStates(key, "installation", repoKey, fetch)
      yield* TestClock.adjust(Duration.seconds(16))
      shouldFail = true
      const stale = yield* cache.cachedProjectStates(
        key,
        "installation",
        repoKey,
        fetch
      )
      expect(stale.refreshStatus).toBe("rate_limited")
      expect(stale.retryAt).toBe(1234)
      expect(stale.fetchedAt).toBeUndefined()

      shouldFail = false
      const fresh = yield* cache.cachedProjectStates(
        key,
        "installation",
        repoKey,
        fetch
      )
      expect(fresh.refreshStatus).toBeUndefined()
      expect(calls).toBe(3)
    }).pipe(Effect.provide(ProjectStateCache.layer))
)

it.effect("does not return stale data when the repository is gone", () =>
  Effect.gen(function* () {
    const cache = yield* ProjectStateCache.ProjectStateCache
    let shouldFail = false
    const { key, repoKey } = keyFor("gone")
    const fetch = Effect.gen(function* () {
      if (shouldFail) return yield* new RepoGone()
      return snapshot
    })

    yield* cache.cachedProjectStates(key, "installation", repoKey, fetch)
    yield* TestClock.adjust(Duration.seconds(16))
    shouldFail = true
    const error = yield* cache
      .cachedProjectStates(key, "installation", repoKey, fetch)
      .pipe(Effect.flip)
    expect(error._tag).toBe("RepoGone")
  }).pipe(Effect.provide(ProjectStateCache.layer))
)

it.effect(
  "invalidation during a fetch preserves waiters and cannot restore the invalidated snapshot",
  () =>
    Effect.gen(function* () {
      const cache = yield* ProjectStateCache.ProjectStateCache
      const { key, repoKey } = keyFor("invalidation")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const fetch = Effect.gen(function* () {
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        return snapshot
      })
      const first = yield* cache
        .cachedProjectStates(key, "installation", repoKey, fetch)
        .pipe(Effect.forkChild)
      yield* Deferred.await(started)
      const second = yield* cache
        .cachedProjectStates(key, "installation", repoKey, fetch)
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* cache.invalidateForInstallation("installation")
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(first)).refreshStatus).toBe("stale")
      expect((yield* Fiber.join(second)).refreshStatus).toBe("stale")
      const error = yield* cache
        .cachedProjectStates(
          key,
          "installation",
          repoKey,
          Effect.fail(new GitHubError({ message: "offline" }))
        )
        .pipe(Effect.flip)
      expect(error._tag).toBe("GitHubError")
    }).pipe(Effect.provide(ProjectStateCache.layer))
)

it.effect(
  "all callers observe a shared failure and the next call can recover",
  () =>
    Effect.gen(function* () {
      const cache = yield* ProjectStateCache.ProjectStateCache
      const { key, repoKey } = keyFor("shared-failure")
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      let fail = true
      let calls = 0
      const fetch = Effect.gen(function* () {
        calls += 1
        yield* Deferred.succeed(started, undefined)
        yield* Deferred.await(release)
        if (fail) return yield* new GitHubError({ message: "offline" })
        return snapshot
      })
      const first = yield* cache
        .cachedProjectStates(key, "installation", repoKey, fetch)
        .pipe(Effect.flip, Effect.forkChild)
      yield* Deferred.await(started)
      const second = yield* cache
        .cachedProjectStates(key, "installation", repoKey, fetch)
        .pipe(Effect.flip, Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(release, undefined)
      expect((yield* Fiber.join(first))._tag).toBe("GitHubError")
      expect((yield* Fiber.join(second))._tag).toBe("GitHubError")
      expect(calls).toBe(1)
      fail = false
      expect(
        yield* cache.cachedProjectStates(key, "installation", repoKey, fetch)
      ).toEqual(snapshot)
      expect(calls).toBe(2)
    }).pipe(Effect.provide(ProjectStateCache.layer))
)

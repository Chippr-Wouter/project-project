import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { GitHubError, RateLimited, RepoGone } from "@projectproject/shared"
import type { RawProjectStates } from "../../Services/GitHub"

type ProjectStateFailure = RepoGone | RateLimited | GitHubError

type Entry = {
  readonly installationId: string
  readonly repoKey: string
  run?: Effect.Effect<RawProjectStates, ProjectStateFailure>
  snapshot?: RawProjectStates
}

const LIMIT = 128

export class ProjectStateCache extends Context.Service<
  ProjectStateCache,
  {
    readonly cachedProjectStates: (
      key: string,
      installationId: string,
      repoKey: string,
      fetch: Effect.Effect<RawProjectStates, ProjectStateFailure>
    ) => Effect.Effect<RawProjectStates, ProjectStateFailure>
    readonly invalidateForRepo: (repoKey: string) => Effect.Effect<void>
    readonly invalidateForInstallation: (
      installationId: string
    ) => Effect.Effect<void>
  }
>()("@projectproject/backend/Layers/GitHub/projectStateCache") {}

export const make = (): ProjectStateCache["Service"] => {
  const entries = new Map<string, Entry>()

  const cachedProjectStates = Effect.fn("GitHub.cachedProjectStates")(
    function* (
      key: string,
      installationId: string,
      repoKey: string,
      fetch: Effect.Effect<RawProjectStates, ProjectStateFailure>
    ): Effect.fn.Return<RawProjectStates, ProjectStateFailure> {
      const entry = yield* Effect.sync(() => {
        const existing = entries.get(key)
        if (existing) return existing
        const created: Entry = { installationId, repoKey }
        if (entries.size >= LIMIT) {
          const oldestKey = entries.keys().next().value
          if (oldestKey !== undefined) entries.delete(oldestKey)
        }
        entries.set(key, created)
        return created
      })
      if (!entry.run) {
        const run = yield* Effect.cachedWithTTL(fetch, "15 seconds")
        entry.run ??= run
      }
      const run = entry.run
      return yield* run.pipe(
        Effect.map((value): RawProjectStates => {
          if (entries.get(key) !== entry)
            return { ...value, refreshStatus: "stale" }
          entry.snapshot = value
          return value
        }),
        Effect.catch(
          (error): Effect.Effect<RawProjectStates, ProjectStateFailure> => {
            if (entry.run === run) {
              entry.run = undefined
              if (error._tag === "RepoGone") entry.snapshot = undefined
            }
            if (error._tag === "RepoGone") return Effect.fail(error)
            if (entries.get(key) !== entry || !entry.snapshot)
              return Effect.fail(error)
            return Effect.succeed({
              ...entry.snapshot,
              refreshStatus:
                error._tag === "RateLimited" ? "rate_limited" : "stale",
              ...(error._tag === "RateLimited"
                ? { retryAt: error.resetAt }
                : {})
            })
          }
        )
      )
    }
  )

  const invalidateForRepo = (repoKey: string) =>
    Effect.sync(() => {
      for (const [key, entry] of entries) {
        if (entry.repoKey === repoKey.toLowerCase()) entries.delete(key)
      }
    })

  const invalidateForInstallation = (installationId: string) =>
    Effect.sync(() => {
      for (const [key, entry] of entries) {
        if (entry.installationId === installationId) entries.delete(key)
      }
    })

  return ProjectStateCache.of({
    cachedProjectStates,
    invalidateForRepo,
    invalidateForInstallation
  })
}

export const layer = Layer.sync(ProjectStateCache, make)

export const projectStateCacheKey = (
  installationId: string,
  owner: string,
  name: string,
  branches: ReadonlyArray<string>,
  branchQuery: string | undefined
): { readonly key: string; readonly repoKey: string } => {
  const repoKey = `${owner.toLowerCase()}\0${name.toLowerCase()}`
  return {
    key: JSON.stringify([
      installationId,
      repoKey,
      branchQuery,
      [...new Set(branches)].toSorted()
    ]),
    repoKey
  }
}

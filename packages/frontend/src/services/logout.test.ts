import { describe, expect, it } from "vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import { runLogout, type LogoutStrategies } from "./logout"

class CaptureFailure extends Schema.TaggedError<CaptureFailure>()(
  "CaptureFailure",
  {}
) {}

class CacheFailure extends Schema.TaggedError<CacheFailure>()(
  "CacheFailure",
  {}
) {}

class ServerFailure extends Schema.TaggedError<ServerFailure>()(
  "ServerFailure",
  {}
) {}

const strategies = (
  overrides: Partial<
    LogoutStrategies<
      "cache-token",
      CaptureFailure,
      ServerFailure,
      CacheFailure,
      never
    >
  > = {}
): LogoutStrategies<
  "cache-token",
  CaptureFailure,
  ServerFailure,
  CacheFailure,
  never
> => ({
  captureCacheToken: () => Effect.succeed("cache-token"),
  serverSignOut: () => Effect.void,
  clearCache: () => Effect.void,
  resetLocalAuth: () => Effect.void,
  ...overrides
})

const failedError = <E>(exit: Exit.Exit<unknown, E>): E => {
  if (Exit.isSuccess(exit)) throw new Error("expected a failed exit")
  const error = Cause.findError(exit.cause)
  if (error._tag === "Failure") throw new Error("expected a typed failure")
  return error.success
}

describe("runLogout", () => {
  it("signs out and resets local auth when cache-token capture fails", async () => {
    const events: string[] = []
    const exit = await Effect.runPromiseExit(
      runLogout(
        strategies({
          captureCacheToken: () => Effect.fail(new CaptureFailure()),
          serverSignOut: () =>
            Effect.sync(() => {
              events.push("server")
            }),
          clearCache: () =>
            Effect.sync(() => {
              events.push("clear")
            }),
          resetLocalAuth: () =>
            Effect.sync(() => {
              events.push("reset")
            })
        })
      )
    )

    expect(events).toEqual(["server", "reset"])
    expect(failedError(exit)).toBeInstanceOf(CaptureFailure)
  })

  it("resets local auth and preserves a cache-cleanup failure", async () => {
    const events: string[] = []
    const exit = await Effect.runPromiseExit(
      runLogout(
        strategies({
          serverSignOut: () =>
            Effect.sync(() => {
              events.push("server")
            }),
          clearCache: (token) =>
            Effect.sync(() => {
              events.push(`clear:${token}`)
            }).pipe(Effect.andThen(Effect.fail(new CacheFailure()))),
          resetLocalAuth: () =>
            Effect.sync(() => {
              events.push("reset")
            })
        })
      )
    )

    expect(events).toEqual(["server", "clear:cache-token", "reset"])
    expect(failedError(exit)).toBeInstanceOf(CacheFailure)
  })

  it("clears the captured cache before resetting local auth", async () => {
    const events: string[] = []
    const exit = await Effect.runPromiseExit(
      runLogout(
        strategies({
          serverSignOut: () =>
            Effect.sync(() => {
              events.push("server")
            }),
          clearCache: (token) =>
            Effect.sync(() => {
              events.push(`clear:${token}`)
            }),
          resetLocalAuth: () =>
            Effect.sync(() => {
              events.push("reset")
            })
        })
      )
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    expect(events).toEqual(["server", "clear:cache-token", "reset"])
  })

  it("does not clear cache or reset local auth when server signout fails", async () => {
    const events: string[] = []
    const exit = await Effect.runPromiseExit(
      runLogout(
        strategies({
          serverSignOut: () =>
            Effect.sync(() => {
              events.push("server")
            }).pipe(Effect.andThen(Effect.fail(new ServerFailure()))),
          clearCache: () =>
            Effect.sync(() => {
              events.push("clear")
            }),
          resetLocalAuth: () =>
            Effect.sync(() => {
              events.push("reset")
            })
        })
      )
    )

    expect(events).toEqual(["server"])
    expect(failedError(exit)).toBeInstanceOf(ServerFailure)
  })

  it("resets local auth when cache cleanup is interrupted after signout", async () => {
    const events: string[] = []
    const exit = await Effect.runPromiseExit(
      runLogout(
        strategies({
          serverSignOut: () =>
            Effect.sync(() => {
              events.push("server")
            }),
          clearCache: () => Effect.interrupt,
          resetLocalAuth: () =>
            Effect.sync(() => {
              events.push("reset")
            })
        })
      )
    )

    if (Exit.isSuccess(exit)) throw new Error("expected an interrupted exit")
    expect(Cause.hasInterrupts(exit.cause)).toBe(true)
    expect(events).toEqual(["server", "reset"])
  })
})

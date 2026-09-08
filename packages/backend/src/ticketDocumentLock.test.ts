import { it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import { describe, expect } from "vite-plus/test"
import * as TicketDocumentLock from "./ticketDocumentLock"

const withLockService = <A, E>(
  effect: Effect.Effect<A, E, TicketDocumentLock.TicketDocumentLock>
) => effect.pipe(Effect.provide(TicketDocumentLock.layer))

describe("TicketDocumentLock", () => {
  it.effect("serializes work for one ticket", () =>
    withLockService(
      Effect.gen(function* () {
        const lock = yield* TicketDocumentLock.TicketDocumentLock
        const releaseFirst = yield* Deferred.make<void>()
        const firstStarted = yield* Deferred.make<void>()
        const events: Array<string> = []
        const first = yield* Effect.forkChild(
          lock.withTicketDocumentLock(
            "org",
            "project",
            "T-1",
            Effect.gen(function* () {
              events.push("first:start")
              yield* Deferred.succeed(firstStarted, undefined)
              yield* Deferred.await(releaseFirst)
              events.push("first:end")
            })
          )
        )

        yield* Deferred.await(firstStarted)
        const second = yield* Effect.forkChild(
          lock.withTicketDocumentLock(
            "org",
            "project",
            "T-1",
            Effect.sync(() => events.push("second"))
          )
        )
        yield* Effect.yieldNow
        expect(events).toEqual(["first:start"])

        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(events).toEqual(["first:start", "first:end", "second"])
      })
    )
  )

  it.effect("allows work for different tickets to run concurrently", () =>
    withLockService(
      Effect.gen(function* () {
        const lock = yield* TicketDocumentLock.TicketDocumentLock
        const releaseFirst = yield* Deferred.make<void>()
        const secondStarted = yield* Deferred.make<void>()
        const first = yield* Effect.forkChild(
          lock.withTicketDocumentLock(
            "org",
            "project",
            "T-1",
            Deferred.await(releaseFirst)
          )
        )
        const second = yield* Effect.forkChild(
          lock.withTicketDocumentLock(
            "org",
            "project",
            "T-2",
            Deferred.succeed(secondStarted, undefined)
          )
        )

        yield* Deferred.await(secondStarted)
        yield* Deferred.succeed(releaseFirst, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
      })
    )
  )

  it.effect("uses a separate namespace for repository locks", () =>
    withLockService(
      Effect.gen(function* () {
        const lock = yield* TicketDocumentLock.TicketDocumentLock
        const releaseTicket = yield* Deferred.make<void>()
        const repositoryStarted = yield* Deferred.make<void>()
        const ticket = yield* Effect.forkChild(
          lock.withTicketDocumentLock(
            "org",
            "project",
            "repo",
            Deferred.await(releaseTicket)
          )
        )
        const repository = yield* Effect.forkChild(
          lock.withRepositoryBranchLock(
            "org/repo",
            Deferred.succeed(repositoryStarted, undefined)
          )
        )

        yield* Deferred.await(repositoryStarted)
        yield* Deferred.succeed(releaseTicket, undefined)
        yield* Fiber.join(ticket)
        yield* Fiber.join(repository)
      })
    )
  )

  it.effect("isolates state between service layers", () =>
    Effect.gen(function* () {
      let calls = 0
      const work = Effect.sync(() => {
        calls += 1
      })
      const run = Effect.gen(function* () {
        const lock = yield* TicketDocumentLock.TicketDocumentLock
        yield* lock.withTicketDocumentLock("org", "project", "T-1", work)
      })

      yield* run.pipe(Effect.provide(TicketDocumentLock.layer))
      yield* run.pipe(Effect.provide(TicketDocumentLock.layer))

      expect(calls).toBe(2)
    })
  )
})

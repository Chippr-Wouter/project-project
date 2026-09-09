import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"

type LockEntry = {
  readonly semaphore: Semaphore.Semaphore
  users: number
}

const ticketLockKey = (
  orgSlug: string,
  projectSlug: string,
  ticketId: string
) => JSON.stringify(["ticket", orgSlug, projectSlug, ticketId])

const repositoryLockKey = (repoId: string) =>
  JSON.stringify(["repository", repoId])

export class TicketDocumentLock extends Context.Service<
  TicketDocumentLock,
  {
    readonly withTicketDocumentLock: <A, E, R>(
      orgSlug: string,
      projectSlug: string,
      ticketId: string,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>
    readonly withRepositoryBranchLock: <A, E, R>(
      repoId: string,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>
  }
>()("@projectproject/backend/ticketDocumentLock") {}

export const make = (): TicketDocumentLock["Service"] => {
  const locks = new Map<string, LockEntry>()

  const withLock = <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const existing = locks.get(key)
        if (existing) {
          existing.users += 1
          return existing
        }

        const created: LockEntry = {
          semaphore: Semaphore.makeUnsafe(1),
          users: 1
        }
        locks.set(key, created)
        return created
      }),
      (entry) => entry.semaphore.withPermit(effect),
      (entry) =>
        Effect.sync(() => {
          entry.users -= 1
          if (entry.users === 0) locks.delete(key)
        })
    )

  return TicketDocumentLock.of({
    withTicketDocumentLock: (orgSlug, projectSlug, ticketId, effect) =>
      withLock(ticketLockKey(orgSlug, projectSlug, ticketId), effect),
    withRepositoryBranchLock: (repoId, effect) =>
      withLock(repositoryLockKey(repoId), effect)
  })
}

export const layer = Layer.sync(TicketDocumentLock, make)

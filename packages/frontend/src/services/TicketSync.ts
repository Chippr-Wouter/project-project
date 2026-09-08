import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Scope from "effect/Scope"
import * as Semaphore from "effect/Semaphore"
import * as ApiClient from "./ApiClient"
import * as TicketSyncStorage from "./TicketSyncStorage"
import {
  NotFound,
  Unauthorized,
  TicketSyncSnapshotPrototype,
  type TicketSyncDeltaPrototype
} from "@projectproject/shared"
import {
  applyTicketDeltaPrototype,
  ticketSyncPrototypeEnabled,
  TicketSyncAuthChangedPrototype,
  type TicketSyncParamsPrototype,
  type TicketSyncOwnerPrototype,
  type TicketSyncAuthTokenPrototype
} from "@/atoms/ticketSyncPrototype"

type Snapshot = typeof TicketSyncSnapshotPrototype.Type
type Delta = typeof TicketSyncDeltaPrototype.Type
const lifecycleEventSchema = Schema.Struct({
  owner: Schema.Struct({
    server: Schema.String,
    userId: Schema.String,
    generation: Schema.Int
  }),
  project: Schema.NullOr(
    Schema.Struct({ id: Schema.String, generation: Schema.Int })
  )
})
type LifecycleEvent = typeof lifecycleEventSchema.Type
const accountKey = (owner: TicketSyncOwnerPrototype) =>
  JSON.stringify([owner.server, owner.userId])
const projectKey = (
  owner: TicketSyncOwnerPrototype,
  params: TicketSyncParamsPrototype
) => JSON.stringify([owner.server, owner.userId, params.orgSlug, params.slug])
const sameOwner = (
  left: TicketSyncOwnerPrototype | undefined | null,
  right: TicketSyncOwnerPrototype
) =>
  left?.server === right.server &&
  left.userId === right.userId &&
  left.generation === right.generation
const isFixture = (params: TicketSyncParamsPrototype) =>
  params.orgSlug === "measure" && params.slug === "ten-thousand"

const sameCheckpoint = (
  left: Snapshot["checkpoint"],
  right: Snapshot["checkpoint"]
) => left.epoch === right.epoch && left.revision === right.revision

export class TicketSync extends Context.Service<
  TicketSync,
  {
    readonly capture: Effect.Effect<
      TicketSyncAuthTokenPrototype,
      Effect.Error<Effect.Success<typeof make>["capture"]>
    >
    readonly activate: Effect.Success<typeof make>["activate"]
    readonly clear: Effect.Success<typeof make>["clear"]
    readonly subscribe: (
      callback: (event: LifecycleEvent) => void
    ) => Effect.Effect<void, never, Scope.Scope>
    readonly read: Effect.Success<typeof make>["read"]
    readonly poll: Effect.Success<typeof make>["poll"]
    readonly reset: Effect.Effect<void>
  }
>()("@projectproject/frontend/services/TicketSync") {}

export const make = Effect.gen(function* () {
  const storage = yield* TicketSyncStorage.TicketSyncStorage
  const client = yield* ApiClient.ApiClient
  const server = location.origin
  const replicaLock = yield* Semaphore.make(1)
  const memory = new Map<string, { generation: number; snapshot: Snapshot }>()
  const projectVersions = new Map<string, number>()
  let activeOwner: TicketSyncOwnerPrototype | undefined
  let localGeneration = 0
  let disposed = false
  const subscribers = new Set<(event: LifecycleEvent) => void>()
  const channel =
    ticketSyncPrototypeEnabled && typeof BroadcastChannel !== "undefined"
      ? yield* Effect.acquireRelease(
          Effect.sync(
            () => new BroadcastChannel("projectproject-ticket-sync-v2")
          ),
          (channel) => Effect.sync(() => channel.close())
        )
      : undefined
  const acceptNotification = (event: LifecycleEvent) => {
    if (!sameOwner(activeOwner, event.owner)) return false
    if (event.project) {
      const previous = projectVersions.get(event.project.id)
      if (previous !== undefined && previous >= event.project.generation)
        return false
      projectVersions.set(event.project.id, event.project.generation)
      memory.delete(event.project.id)
    } else {
      localGeneration = Math.max(localGeneration, event.owner.generation + 1)
      activeOwner = undefined
      memory.clear()
      projectVersions.clear()
    }
    return true
  }
  const receiveNotification = (message: MessageEvent<unknown>) => {
    const decoded = Schema.decodeUnknownOption(lifecycleEventSchema)(
      message.data
    )
    if (decoded._tag === "None" || !acceptNotification(decoded.value)) return
    for (const callback of subscribers) callback(decoded.value)
  }
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      channel?.addEventListener("message", receiveNotification)
    ),
    () =>
      Effect.sync(() => {
        channel?.removeEventListener("message", receiveNotification)
        disposed = true
        subscribers.clear()
        memory.clear()
        projectVersions.clear()
        activeOwner = undefined
      })
  )
  const subscribeTicketSyncLifecycle = Effect.fn("TicketSync.subscribe")(
    function* (callback: (event: LifecycleEvent) => void) {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          subscribers.add(callback)
        }),
        () =>
          Effect.sync(() => {
            subscribers.delete(callback)
          })
      )
    }
  )
  const notify = Effect.fn("TicketSync.notify")(function* (
    event: LifecycleEvent,
    local: boolean
  ) {
    yield* Effect.sync(() => {
      // BroadcastChannel.postMessage has no targetOrigin parameter.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      channel?.postMessage(event)
      if (local) for (const callback of subscribers) callback(event)
    })
  })
  const readHead = Effect.gen(function* () {
    const db = yield* storage.database
    return (
      (yield* db.from("auth").select().equals("global"))[0] ?? {
        id: "global" as const,
        generation: 0,
        userId: null
      }
    )
  })
  const requireOwner = Effect.fn("requireTicketSyncOwner")(function* (
    owner: TicketSyncOwnerPrototype
  ) {
    const head = yield* readHead
    if (
      owner.server !== server ||
      head.generation !== owner.generation ||
      head.userId !== owner.userId
    )
      return yield* new Unauthorized()
    return undefined
  })
  const deleteAccount = Effect.fn("deleteTicketSyncAccount")(function* (
    owner: TicketSyncOwnerPrototype
  ) {
    const db = yield* storage.database
    yield* db.from("snapshot").delete("byAccount").equals(accountKey(owner))
    yield* db.from("project").delete("byAccount").equals(accountKey(owner))
  })
  const captureTicketSyncAuth = Effect.gen(function* () {
    if (disposed) return yield* new Unauthorized()
    const head = yield* readHead
    return {
      generation: head.generation,
      owner:
        head.userId === null
          ? null
          : { server, userId: head.userId, generation: head.generation }
    } satisfies TicketSyncAuthTokenPrototype
  })

  const activateTicketSyncAccount = Effect.fn("activateTicketSyncAccount")(
    function* (userId: string, token: TicketSyncAuthTokenPrototype) {
      if (disposed) return yield* new Unauthorized()
      const db = yield* storage.database
      const result = yield* Effect.gen(function* () {
        const head = yield* readHead
        if (head.generation !== token.generation)
          return yield* new TicketSyncAuthChangedPrototype()
        if (head.userId === userId)
          return {
            owner: { server, userId, generation: head.generation },
            previous: null
          }
        const previous =
          head.userId === null
            ? null
            : { server, userId: head.userId, generation: head.generation }
        if (previous) yield* deleteAccount(previous)
        const generation = head.generation + 1
        yield* db.from("auth").upsert({ id: "global", userId, generation })
        return { owner: { server, userId, generation }, previous }
      }).pipe(
        db.withTransaction({
          tables: ["auth", "project", "snapshot"],
          mode: "readwrite"
        })
      )
      if (result.owner.generation < localGeneration)
        return yield* new TicketSyncAuthChangedPrototype()
      const previousLocalOwner = activeOwner
      const local =
        previousLocalOwner !== undefined &&
        !sameOwner(previousLocalOwner, result.owner)
      if (!sameOwner(activeOwner, result.owner)) {
        memory.clear()
        projectVersions.clear()
      }
      activeOwner = result.owner
      localGeneration = result.owner.generation
      const previous =
        result.previous ?? (local ? previousLocalOwner : undefined)
      if (previous) yield* notify({ owner: previous, project: null }, local)
      return result.owner
    }
  )

  const clearTicketSyncAccount = Effect.fn("clearTicketSyncAccount")(function* (
    token: TicketSyncAuthTokenPrototype
  ) {
    const localOwner =
      activeOwner &&
      (activeOwner.generation < token.generation ||
        (token.owner !== null && sameOwner(activeOwner, token.owner)))
        ? activeOwner
        : undefined
    if (localOwner) {
      activeOwner = undefined
      memory.clear()
      projectVersions.clear()
      localGeneration = Math.max(localGeneration, token.generation + 1)
    }
    const cleared = yield* Effect.gen(function* () {
      const db = yield* storage.database
      return yield* Effect.gen(function* () {
        const head = yield* readHead
        if (
          head.generation !== token.generation ||
          head.userId !== (token.owner?.userId ?? null)
        )
          return false
        if (token.owner) yield* deleteAccount(token.owner)
        yield* db.from("auth").upsert({
          id: "global",
          userId: null,
          generation: head.generation + 1
        })
        return true
      }).pipe(
        db.withTransaction({
          tables: ["auth", "project", "snapshot"],
          mode: "readwrite"
        })
      )
    }).pipe(
      Effect.onExit((exit) =>
        exit._tag === "Failure" && localOwner
          ? notify({ owner: localOwner, project: null }, true)
          : Effect.void
      )
    )
    if (cleared) {
      localGeneration = Math.max(localGeneration, token.generation + 1)
      const stillActive =
        token.owner !== null && sameOwner(activeOwner, token.owner)
      if (stillActive) {
        activeOwner = undefined
        memory.clear()
        projectVersions.clear()
      }
      const revoked = token.owner ?? localOwner
      if (revoked)
        yield* notify(
          { owner: revoked, project: null },
          localOwner !== undefined || stillActive
        )
    } else if (localOwner)
      yield* notify({ owner: localOwner, project: null }, true)
  })

  type ProjectLease = {
    readonly id: string
    readonly generation: number
    readonly snapshot: Snapshot | undefined
  }
  const prepareProject = Effect.fn("prepareTicketSyncProject")(function* (
    owner: TicketSyncOwnerPrototype,
    params: TicketSyncParamsPrototype
  ) {
    if (!isFixture(params)) return yield* new NotFound()
    if (!sameOwner(activeOwner, owner)) return yield* new Unauthorized()
    const db = yield* storage.database
    const id = projectKey(owner, params)
    const lease = yield* Effect.gen(function* () {
      yield* requireOwner(owner)
      let project = (yield* db.from("project").select().equals(id))[0]
      if (!project) {
        project = { id, accountId: accountKey(owner), generation: 0 }
        yield* db.from("project").upsert(project)
      }
      const cached = memory.get(id)
      if (cached?.generation === project.generation)
        return { id, generation: project.generation, snapshot: cached.snapshot }
      const saved = (yield* db.from("snapshot").select().equals(id))[0]
      return {
        id,
        generation: project.generation,
        snapshot: saved?.generation === project.generation ? saved : undefined
      }
    }).pipe(
      db.withTransaction({
        tables: ["auth", "project", "snapshot"],
        mode: "readwrite"
      })
    )
    if (!sameOwner(activeOwner, owner)) return yield* new Unauthorized()
    if ((projectVersions.get(id) ?? -1) > lease.generation)
      return yield* new NotFound()
    const previous = memory.get(id)
    if (previous && previous.generation < lease.generation) {
      memory.delete(id)
      yield* notify(
        { owner, project: { id, generation: lease.generation } },
        true
      )
    }
    projectVersions.set(id, lease.generation)
    if (lease.snapshot)
      memory.set(id, { generation: lease.generation, snapshot: lease.snapshot })
    return lease
  })
  const clearProject = Effect.fn("clearTicketSyncProject")(function* (
    owner: TicketSyncOwnerPrototype,
    lease: ProjectLease
  ) {
    const db = yield* storage.database
    const local =
      sameOwner(activeOwner, owner) &&
      memory.get(lease.id)?.generation === lease.generation
    const changed = yield* Effect.gen(function* () {
      const head = yield* readHead
      if (head.generation !== owner.generation || head.userId !== owner.userId)
        return false
      const project = (yield* db.from("project").select().equals(lease.id))[0]
      if (!project || project.generation !== lease.generation) return false
      const saved = (yield* db.from("snapshot").select().equals(lease.id))[0]
      yield* db.from("snapshot").delete().equals(lease.id)
      yield* db
        .from("project")
        .upsert({ ...project, generation: project.generation + 1 })
      return saved !== undefined
    }).pipe(
      db.withTransaction({
        tables: ["auth", "project", "snapshot"],
        mode: "readwrite"
      })
    )
    if (sameOwner(activeOwner, owner)) {
      memory.delete(lease.id)
      projectVersions.set(
        lease.id,
        Math.max(projectVersions.get(lease.id) ?? -1, lease.generation + 1)
      )
    }
    if (changed || local)
      yield* notify(
        { owner, project: { id: lease.id, generation: lease.generation + 1 } },
        local
      )
  })
  const handleDenied =
    (owner: TicketSyncOwnerPrototype, lease: ProjectLease) =>
    <A, E extends { readonly _tag: string }, R>(
      request: Effect.Effect<A, E, R>
    ) =>
      request.pipe(
        Effect.tapError((error) => {
          if (error._tag === "Unauthorized")
            return clearTicketSyncAccount({
              generation: owner.generation,
              owner
            })
          if (error._tag === "NotFound") return clearProject(owner, lease)
          return Effect.void
        })
      )
  const commit = Effect.fn("commitTicketSyncReplica")(function* (
    owner: TicketSyncOwnerPrototype,
    lease: ProjectLease,
    change:
      | { readonly kind: "snapshot"; readonly value: Snapshot }
      | {
          readonly kind: "delta"
          readonly value: Delta
          readonly base: Snapshot
        }
  ) {
    const db = yield* storage.database
    const snapshot = yield* Effect.gen(function* () {
      yield* requireOwner(owner)
      const project = (yield* db.from("project").select().equals(lease.id))[0]
      if (project?.generation !== lease.generation) return yield* new NotFound()
      const previous = (yield* db.from("snapshot").select().equals(lease.id))[0]
      if (
        change.kind === "delta" &&
        previous &&
        !sameCheckpoint(previous.checkpoint, change.base.checkpoint)
      )
        return previous
      if (
        change.kind === "snapshot" &&
        previous &&
        (!lease.snapshot ||
          !sameCheckpoint(previous.checkpoint, lease.snapshot.checkpoint))
      )
        return previous
      const next =
        change.kind === "snapshot"
          ? change.value
          : applyTicketDeltaPrototype(previous ?? change.base, change.value)
      yield* db.from("snapshot").upsert({
        id: lease.id,
        accountId: accountKey(owner),
        generation: lease.generation,
        ...next
      })
      return next
    }).pipe(
      db.withTransaction({
        tables: ["auth", "project", "snapshot"],
        mode: "readwrite"
      })
    )
    if (!sameOwner(activeOwner, owner)) return yield* new Unauthorized()
    if (projectVersions.get(lease.id) !== lease.generation)
      return yield* new NotFound()
    memory.set(lease.id, { generation: lease.generation, snapshot })
    return snapshot
  })
  const readTicketSyncPrototype = Effect.fn("readTicketSyncPrototype")(
    function* (
      owner: TicketSyncOwnerPrototype,
      params: TicketSyncParamsPrototype
    ) {
      const lease = yield* prepareProject(owner, params)
      if (lease.snapshot) return lease.snapshot.items
      const incoming = yield* client.tickets
        .prototypeSyncSnapshot({ params })
        .pipe(handleDenied(owner, lease))
      return (yield* commit(owner, lease, {
        kind: "snapshot",
        value: incoming
      }).pipe(handleDenied(owner, lease))).items
    },
    replicaLock.withPermits(1)
  )

  const pollTicketSyncPrototype = Effect.fn("pollTicketSyncPrototype")(
    function* (
      owner: TicketSyncOwnerPrototype,
      params: TicketSyncParamsPrototype
    ) {
      const lease = yield* prepareProject(owner, params)
      if (lease.snapshot) {
        const delta = yield* client.tickets
          .prototypeSyncDelta({ params, query: lease.snapshot.checkpoint })
          .pipe(handleDenied(owner, lease))
        if (!delta.reset) {
          if (sameCheckpoint(delta.checkpoint, lease.snapshot.checkpoint))
            return false
          yield* commit(owner, lease, {
            kind: "delta",
            value: delta,
            base: lease.snapshot
          }).pipe(handleDenied(owner, lease))
          return true
        }
      }
      const incoming = yield* client.tickets
        .prototypeSyncSnapshot({ params })
        .pipe(handleDenied(owner, lease))
      yield* commit(owner, lease, { kind: "snapshot", value: incoming }).pipe(
        handleDenied(owner, lease)
      )
      return true
    },
    replicaLock.withPermits(1)
  )

  const reset = Effect.sync(() => {
    activeOwner = undefined
    memory.clear()
    projectVersions.clear()
    localGeneration += 1
  })
  return {
    capture: captureTicketSyncAuth,
    activate: activateTicketSyncAccount,
    clear: clearTicketSyncAccount,
    subscribe: subscribeTicketSyncLifecycle,
    read: readTicketSyncPrototype,
    poll: pollTicketSyncPrototype,
    reset
  }
})
export const layer = Layer.effect(TicketSync, make).pipe(
  Layer.provide(TicketSyncStorage.layer)
)

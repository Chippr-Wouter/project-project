import * as IndexedDb from "@effect/platform-browser/IndexedDb"
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase"
import * as IndexedDbTable from "@effect/platform-browser/IndexedDbTable"
import * as IndexedDbVersion from "@effect/platform-browser/IndexedDbVersion"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Semaphore from "effect/Semaphore"
import {
  TicketSyncSnapshotPrototype,
  type TicketSyncDeltaPrototype
} from "@projectproject/shared"
import { ApiClient } from "@/services/ApiClient"

type Snapshot = typeof TicketSyncSnapshotPrototype.Type
type Delta = typeof TicketSyncDeltaPrototype.Type
export const ticketSyncPrototypeEnabled =
  import.meta.env.VITE_TICKET_SYNC_PROTOTYPE === "true"
const params = { orgSlug: "measure", slug: "ten-thousand" }
const store = IndexedDbTable.make({
  name: "replica",
  schema: Schema.Struct({
    id: Schema.String,
    ...TicketSyncSnapshotPrototype.fields
  }),
  keyPath: "id"
})
const database = IndexedDbDatabase.make(
  IndexedDbVersion.make(store),
  Effect.fn(function* (migration) {
    yield* migration.createObjectStore("replica")
  })
)
const layer = database
  .layer("PROTOTYPE-ticket-sync-v1")
  .pipe(Layer.provide(IndexedDb.layerWindow))
const lock = Semaphore.makeUnsafe(1)
let current: Snapshot | undefined

export function applyTicketDeltaPrototype(
  base: Snapshot,
  delta: Delta
): Snapshot {
  if (
    delta.reset ||
    delta.checkpoint.epoch !== base.checkpoint.epoch ||
    delta.checkpoint.revision < base.checkpoint.revision
  )
    throw new Error("Invalid delta checkpoint")
  const items = new Map(base.items.map((ticket) => [ticket.id, ticket]))
  for (const id of delta.deleted) items.delete(id)
  for (const ticket of delta.items) items.set(ticket.id, ticket)
  return {
    checkpoint: delta.checkpoint,
    items: [...items.values()].toSorted(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() ||
        a.id.localeCompare(b.id)
    )
  }
}

const persist = Effect.fn(function* (incoming: Snapshot) {
  const db = yield* database
  return yield* Effect.gen(function* () {
    const previous = (yield* db.from("replica").select().equals("fixture"))[0]
    if (
      previous?.checkpoint.epoch === incoming.checkpoint.epoch &&
      previous.checkpoint.revision > incoming.checkpoint.revision
    )
      return previous
    yield* db.from("replica").upsert({ id: "fixture", ...incoming })
    return incoming
  }).pipe(db.withTransaction({ tables: ["replica"], mode: "readwrite" }))
})

const initialize = Effect.runSync(
  Effect.cached(
    Effect.gen(function* () {
      const db = yield* database
      const saved = (yield* db.from("replica").select().equals("fixture"))[0]
      if (saved) {
        current = saved
        return
      }
      const client = yield* ApiClient
      current = yield* persist(
        yield* client.tickets.prototypeSyncSnapshot({ params })
      )
    }).pipe(Effect.provide(layer), Effect.scoped)
  )
)

export const readTicketSyncPrototype = Effect.gen(function* () {
  yield* initialize
  if (!current) return yield* Effect.die("Missing replica")
  return current.items
})

export const pollTicketSyncPrototype = Effect.gen(function* () {
  yield* initialize
  const client = yield* ApiClient
  const db = yield* database
  if (!current) return yield* Effect.die("Missing replica")
  const base = current
  const delta = yield* client.tickets.prototypeSyncDelta({
    params,
    query: { epoch: base.checkpoint.epoch, revision: base.checkpoint.revision }
  })
  if (delta.reset) {
    current = yield* persist(
      yield* client.tickets.prototypeSyncSnapshot({ params })
    )
    return true
  }
  if (delta.checkpoint.revision === base.checkpoint.revision) return false
  const next = yield* Effect.gen(function* () {
    const saved = (yield* db.from("replica").select().equals("fixture"))[0]
    if (!saved)
      return yield* Effect.die("Replica was cleared; reload to bootstrap")
    if (
      saved.checkpoint.epoch !== base.checkpoint.epoch ||
      saved.checkpoint.revision !== base.checkpoint.revision
    )
      return saved
    const updated = applyTicketDeltaPrototype(saved, delta)
    yield* db.from("replica").upsert({ id: "fixture", ...updated })
    return updated
  }).pipe(db.withTransaction({ tables: ["replica"], mode: "readwrite" }))
  current = next
  return true
}).pipe(Effect.provide(layer), Effect.scoped, lock.withPermits(1))

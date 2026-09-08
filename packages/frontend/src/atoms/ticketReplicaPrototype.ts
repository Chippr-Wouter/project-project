import * as IndexedDb from "@effect/platform-browser/IndexedDb"
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase"
import * as IndexedDbTable from "@effect/platform-browser/IndexedDbTable"
import * as IndexedDbVersion from "@effect/platform-browser/IndexedDbVersion"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  Ticket,
  matchesTicketQuery,
  type TicketCountQuery,
  type TicketCounts,
  type TicketListQuery
} from "@projectproject/shared"
import * as TicketSync from "@/services/TicketSync"
import { ApiClient } from "@/services/ApiClient"
import {
  ticketSyncPrototypeEnabled,
  type TicketSyncOwnerPrototype
} from "./ticketSyncPrototype"

export const usesTicketReplicaPrototype = (orgSlug: string, slug: string) =>
  import.meta.env.VITE_TICKET_REPLICA_PROTOTYPE === "true" &&
  location.hostname === "localhost" &&
  orgSlug === "measure" &&
  slug === "ten-thousand"

export const supportsReplicaCountQuery = (query: TicketCountQuery) =>
  query.filter?.groupId === undefined &&
  query.filter?.archived !== true &&
  !query.q?.trim()

export const supportsReplicaListQuery = (query: TicketListQuery) =>
  supportsReplicaCountQuery(query) &&
  query.sort.key === "created" &&
  query.sort.dir === "desc" &&
  query.cursor === undefined

const table = IndexedDbTable.make({
  name: "snapshot",
  schema: Schema.Struct({ id: Schema.String, items: Schema.Array(Ticket) }),
  keyPath: "id"
})
const database = IndexedDbDatabase.make(
  IndexedDbVersion.make(table),
  Effect.fn(function* (migration) {
    yield* migration.createObjectStore("snapshot")
  })
)
const layer = database
  .layer("PROTOTYPE-overview-comparison-v1")
  .pipe(Layer.provide(IndexedDb.layerWindow))

const hydrate = Effect.gen(function* () {
  const started = performance.now()
  const db = yield* database
  const snapshot = yield* db.from("snapshot").select().equals("fixture")
  if (snapshot.length > 0) {
    performance.measure("replica-hydrate", { start: started })
    return snapshot[0].items
  }
  const client = yield* ApiClient
  const fetchStarted = performance.now()
  const items: Array<Ticket> = []
  let cursor: string | undefined
  if (import.meta.env.VITE_TICKET_SNAPSHOT_PROTOTYPE === "true") {
    const page = yield* client.tickets.prototypeSnapshot({
      params: { orgSlug: "measure", slug: "ten-thousand" }
    })
    if (page.nextCursor !== null)
      return yield* Effect.die("Snapshot exceeded prototype limit")
    items.push(...page.items)
  } else
    do {
      const page = yield* client.tickets.list({
        params: { orgSlug: "measure", slug: "ten-thousand" },
        query: cursor ? { cursor } : {}
      })
      items.push(...page.items)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
  performance.measure("replica-fetch-decode", { start: fetchStarted })
  if (items.length !== 10000)
    return yield* Effect.die("Expected 10,000 fixture tickets")
  const persistStarted = performance.now()
  yield* db.from("snapshot").upsert({ id: "fixture", items })
  performance.measure("replica-persist", { start: persistStarted })
  performance.measure("replica-bootstrap", { start: started })
  return items
}).pipe(Effect.provide(layer), Effect.scoped)

const snapshot = Effect.runSync(Effect.cached(hydrate))

export const replicaListPrototype = Effect.fn("replicaListPrototype")(
  function* (
    query: TicketListQuery,
    userId: string,
    owner: TicketSyncOwnerPrototype | null
  ) {
    if (!supportsReplicaListQuery(query))
      return yield* Effect.die("Unsupported local replica query")
    if (ticketSyncPrototypeEnabled && !owner)
      return yield* Effect.die("Missing authenticated replica owner")
    const all = yield* owner
      ? (yield* TicketSync.TicketSync).read(owner, {
          orgSlug: "measure",
          slug: "ten-thousand"
        })
      : snapshot
    return {
      items: all.filter((ticket) => matchesTicketQuery(ticket, query, userId)),
      nextCursor: null
    }
  }
)

export const replicaCountPrototype = Effect.fn("replicaCountPrototype")(
  function* (
    query: TicketCountQuery,
    userId: string,
    owner: TicketSyncOwnerPrototype | null
  ) {
    if (!supportsReplicaCountQuery(query))
      return yield* Effect.die("Prototype does not support sprint filters")
    if (ticketSyncPrototypeEnabled && !owner)
      return yield* Effect.die("Missing authenticated replica owner")
    const all = yield* owner
      ? (yield* TicketSync.TicketSync).read(owner, {
          orgSlug: "measure",
          slug: "ten-thousand"
        })
      : snapshot
    const counts: { total: number; byStatus: Record<string, number> } = {
      total: 0,
      byStatus: {}
    }
    for (const ticket of all) {
      if (!matchesTicketQuery(ticket, query, userId)) continue
      counts.total++
      counts.byStatus[ticket.status] = (counts.byStatus[ticket.status] ?? 0) + 1
    }
    return counts satisfies TicketCounts
  }
)

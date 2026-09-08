import * as IndexedDb from "@effect/platform-browser/IndexedDb"
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase"
import * as IndexedDbTable from "@effect/platform-browser/IndexedDbTable"
import * as IndexedDbVersion from "@effect/platform-browser/IndexedDbVersion"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { TicketSyncSnapshotPrototype } from "@projectproject/shared"
import { ticketSyncPrototypeEnabled } from "@/atoms/ticketSyncPrototype"

export class TicketSyncStorageError extends Schema.TaggedError<TicketSyncStorageError>()(
  "TicketSyncStorageError",
  { stage: Schema.Literals(["open", "disabled"]), cause: Schema.Defect() }
) {}
const authTable = IndexedDbTable.make({
  name: "auth",
  keyPath: "id",
  schema: Schema.Struct({
    id: Schema.Literal("global"),
    generation: Schema.Int,
    userId: Schema.NullOr(Schema.String)
  })
})
const projectTable = IndexedDbTable.make({
  name: "project",
  keyPath: "id",
  indexes: { byAccount: "accountId" },
  schema: Schema.Struct({
    id: Schema.String,
    accountId: Schema.String,
    generation: Schema.Int
  })
})
const snapshotTable = IndexedDbTable.make({
  name: "snapshot",
  keyPath: "id",
  indexes: { byAccount: "accountId" },
  schema: Schema.Struct({
    id: Schema.String,
    accountId: Schema.String,
    generation: Schema.Int,
    ...TicketSyncSnapshotPrototype.fields
  })
})
const database = IndexedDbDatabase.make(
  IndexedDbVersion.make(authTable, projectTable, snapshotTable),
  Effect.fn("migrateTicketSyncPrototype")(function* (migration) {
    yield* migration.createObjectStore("auth")
    yield* migration.createObjectStore("project")
    yield* migration.createObjectStore("snapshot")
    yield* migration.createIndex("project", "byAccount")
    yield* migration.createIndex("snapshot", "byAccount")
  })
)

export class TicketSyncStorage extends Context.Service<
  TicketSyncStorage,
  {
    readonly database: Effect.Effect<
      Effect.Success<typeof database>,
      TicketSyncStorageError
    >
  }
>()("@projectproject/frontend/services/TicketSyncStorage") {}

export const make = Effect.gen(function* () {
  const opened = yield* Effect.exit(
    ticketSyncPrototypeEnabled
      ? Layer.build(
          database
            .layer("PROTOTYPE-ticket-sync-v2")
            .pipe(Layer.provide(IndexedDb.layerWindow))
        ).pipe(
          Effect.flatMap((context) => Effect.provideContext(database, context)),
          Effect.catchCause((cause) =>
            Effect.fail(new TicketSyncStorageError({ stage: "open", cause }))
          )
        )
      : Effect.fail(
          new TicketSyncStorageError({
            stage: "disabled",
            cause: new Error("Ticket sync is disabled")
          })
        )
  )
  return { database: opened }
})

export const layer = Layer.effect(TicketSyncStorage, make)

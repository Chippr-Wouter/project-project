import * as IndexedDb from "@effect/platform-browser/IndexedDb"
import * as IndexedDbDatabase from "@effect/platform-browser/IndexedDbDatabase"
import * as IndexedDbTable from "@effect/platform-browser/IndexedDbTable"
import * as IndexedDbVersion from "@effect/platform-browser/IndexedDbVersion"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Schema from "effect/Schema"
import { Ticket } from "@projectproject/shared"

const LocalTicket = Schema.Struct({ ...Ticket.fields, project: Schema.String })
const tickets = IndexedDbTable.make({
  name: "tickets",
  schema: LocalTicket,
  keyPath: ["project", "id"],
  indexes: {
    byProject: "project",
    byProjectStatusCreated: ["project", "status", "createdAt"]
  }
})
const state = IndexedDbTable.make({
  name: "state",
  schema: Schema.Struct({ project: Schema.String, cursor: Schema.String }),
  keyPath: "project"
})
const version = IndexedDbVersion.make(tickets, state)
const database = IndexedDbDatabase.make(
  version,
  Effect.fn(function* (migration) {
    yield* migration.createObjectStore("tickets")
    yield* migration.createIndex("tickets", "byProject")
    yield* migration.createIndex("tickets", "byProjectStatusCreated")
    yield* migration.createObjectStore("state")
  })
)
const databaseLayer = database
  .layer("PROTOTYPE-projectproject-tickets-rc112-v1")
  .pipe(Layer.provide(IndexedDb.layerWindow))
const project = "measure/ten-thousand"
const output = document.querySelector("#output")!
const checks: Array<{ name: string; passed: boolean; detail?: unknown }> = []
const timings: Record<string, Array<number>> = {}
const report = () => {
  output.textContent = JSON.stringify(
    {
      package: "@effect/platform-browser@4.0.0-rc.112",
      fixture: "10,000 synthetic Ticket metadata records; no server requests",
      checks,
      timings,
      complete: false
    },
    null,
    2
  )
}
const check = (name: string, passed: boolean, detail?: unknown) => {
  checks.push({ name, passed, detail })
  report()
  if (!passed) throw new Error(name)
}
const timed = Effect.fn(function* <A, E, R>(
  name: string,
  operation: Effect.Effect<A, E, R>
) {
  const start = performance.now()
  const value = yield* operation
  ;(timings[name] ??= []).push(
    Math.round((performance.now() - start) * 100) / 100
  )
  report()
  return value
})

const program = Effect.gen(function* () {
  const db = yield* database
  const table = db.from("tickets")
  const countBefore = yield* table.count("byProject").equals(project)
  const cursorBefore = yield* db.from("state").select().equals(project)
  check("Database opens", true, {
    persistedTickets: countBefore,
    cursor: cursorBefore[0]?.cursor
  })

  if (countBefore === 0) {
    const fixture = Schema.decodeUnknownSync(Schema.Array(LocalTicket))(
      Array.from({ length: 10000 }, (_, index) => {
        const number = index + 1
        const date = new Date(
          Date.UTC(2026, 0, 1) + number * 1000
        ).toISOString()
        return {
          project,
          id: `T-${number}`,
          title: `Measurement ticket ${number}`,
          status: ["todo", "in_progress", "done"][index % 3],
          type: ["feat", "bug", "chore", "other"][number % 4],
          priority: ["low", "med", "high"][number % 3],
          tags: [],
          assignees: number % 4 === 0 ? ["measure-user"] : [],
          branch: null,
          pr: null,
          prState: null,
          lastTransitionedPr: null,
          gitState: { tag: "no_branch" },
          archivedAt: null,
          createdBy: "measure-user",
          createdAt: date,
          updatedAt: date
        }
      })
    )
    yield* timed(
      "bootstrap10000",
      Effect.gen(function* () {
        yield* table.upsertAll([...fixture])
        yield* db.from("state").upsert({ project, cursor: "snapshot-1" })
      }).pipe(
        db.withTransaction({ tables: ["tickets", "state"], mode: "readwrite" })
      )
    )
  } else {
    check(
      "Reload recovered persisted snapshot",
      countBefore === 10000 && cursorBefore[0]?.cursor === "snapshot-1"
    )
  }

  const todo = Schema.decodeUnknownSync(Ticket.fields.status)("todo")
  const firstId = Schema.decodeUnknownSync(Ticket.fields.id)("T-1")
  for (let sample = 0; sample < 7; sample++) {
    const count = yield* timed(
      "count10000",
      table.count("byProject").equals(project)
    )
    check(`Count ${sample + 1}`, count === 10000)
    const page = yield* timed(
      "newest50Todo",
      table
        .select("byProjectStatusCreated")
        .between([project, todo, ""], [project, todo, "\uffff"])
        .reverse()
        .limit(50)
    )
    check(
      `Indexed page ${sample + 1}`,
      page.length === 50 &&
        page[0].id === "T-10000" &&
        page.every((t) => t.status === "todo")
    )
    const all = yield* timed(
      "hydrate10000",
      table.select("byProject").equals(project)
    )
    check(
      `Schema round trip ${sample + 1}`,
      all.length === 10000 &&
        all.every(
          (t) => t.createdAt instanceof Date && t.updatedAt instanceof Date
        )
    )
    const start = performance.now()
    const ordered = all
      .filter((t) => t.status === todo)
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    ;(timings.filterSortInMemory ??= []).push(
      Math.round((performance.now() - start) * 100) / 100
    )
    check(
      `Local filter/sort ${sample + 1}`,
      ordered.length === 3334 && ordered[0].id === "T-10000"
    )
  }

  const original = (yield* table.select().equals([project, firstId]))[0]
  const queue = yield* table.select().equals([project, firstId]).reactiveQueue()
  yield* Queue.take(queue)
  yield* timed(
    "reactiveUpsert",
    Effect.gen(function* () {
      yield* table
        .upsert({ ...original, title: "Locally updated" })
        .invalidate()
      const updated = yield* Queue.take(queue).pipe(Effect.timeout("3 seconds"))
      check(
        "Reactive query observes upsert",
        updated[0]?.title === "Locally updated"
      )
    })
  )
  yield* table.upsert(original).invalidate()

  const aborted = yield* Effect.exit(
    Effect.gen(function* () {
      yield* table.upsert({ ...original, title: "Must roll back" })
      yield* db.from("state").upsert({ project, cursor: "must-roll-back" })
      return yield* Effect.fail("deliberate transaction failure")
    }).pipe(
      db.withTransaction({ tables: ["tickets", "state"], mode: "readwrite" })
    )
  )
  const afterAbort = yield* table.select().equals([project, firstId])
  const afterCursor = yield* db.from("state").select().equals(project)
  check(
    "Ticket and cursor roll back atomically",
    Exit.isFailure(aborted) &&
      afterAbort[0].title === original.title &&
      afterCursor[0].cursor === "snapshot-1"
  )

  yield* table.delete().equals([project, firstId])
  check(
    "Deletion is reflected locally",
    (yield* table.select().equals([project, firstId])).length === 0
  )
  yield* table.upsert(original)
  check(
    "Fixture restored",
    (yield* table.count("byProject").equals(project)) === 10000
  )
})

Effect.runPromise(
  program.pipe(Effect.scoped, Effect.provide(databaseLayer))
).then(
  () => {
    output.textContent = JSON.stringify(
      { checks, timings, complete: true, userAgent: navigator.userAgent },
      null,
      2
    )
    document.title = "PASS — Ticket IndexedDB prototype"
  },
  (error: unknown) => {
    output.textContent = JSON.stringify(
      { checks, timings, complete: false, error: String(error) },
      null,
      2
    )
    document.title = "FAIL — Ticket IndexedDB prototype"
  }
)

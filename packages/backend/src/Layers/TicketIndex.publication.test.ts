import { expect, it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Data from "effect/Data"
import * as Schema from "effect/Schema"
import * as Fiber from "effect/Fiber"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import * as TestClock from "effect/testing/TestClock"
import { TicketId } from "@projectproject/shared"
import { Db } from "../Services/Db"
import { TicketDocs } from "../Services/TicketDocs"
import { TicketIndex, type TicketIndexProject } from "../Services/TicketIndex"
import type { TicketDocument } from "../Services/TicketDocs"
import { TicketIndexLive } from "./TicketIndex"

const ticketId = Schema.decodeUnknownSync(TicketId)

const project: TicketIndexProject = {
  orgSlug: "acme",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "foo"
}

const document: TicketDocument = {
  id: ticketId("T-1"),
  title: "Publish me",
  status: "todo" as TicketDocument["status"],
  type: "chore",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  assignees: [],
  archivedAt: null,
  createdBy: "user-1",
  createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  body: "# Publish me\n",
  commentsRegion: ""
}

class FakeSqlError extends Data.TaggedError("FakeSqlError")<{
  readonly reason: string
}> {}

const emptySelect = Effect.succeed([])
const selectChain: unknown = new Proxy(emptySelect, {
  get: (target, property, receiver) =>
    property in target
      ? Reflect.get(target, property, receiver)
      : () => selectChain
})

const makeDb = (failures: number) => {
  const state = { attempts: 0 }
  const layer = Layer.succeed(Db, {
    select: () => selectChain,
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () =>
          Effect.suspend(() => {
            state.attempts += 1
            return state.attempts <= failures
              ? Effect.fail(new FakeSqlError({ reason: "connection reset" }))
              : Effect.void
          })
      })
    })
  } as never)
  return { layer, state }
}

const layerFor = (
  db: Layer.Layer<Db>,
  docs: Layer.Layer<TicketDocs> = Layer.succeed(TicketDocs, {} as never)
) =>
  TicketIndexLive.pipe(
    Layer.provide(db),
    Layer.provide(Layer.succeed(SqlClient.SqlClient, {} as never)),
    Layer.provide(docs)
  )

it.effect("retries a transient index publication failure", () => {
  const { layer, state } = makeDb(2)
  return Effect.gen(function* () {
    const index = yield* TicketIndex
    const publishing = yield* Effect.forkChild(
      index.upsertTicket(project, document)
    )
    yield* TestClock.adjust("1 second")
    yield* Fiber.join(publishing)
    expect(state.attempts).toBe(3)
  }).pipe(Effect.provide(layerFor(layer)))
})

it.effect("does not fail the request when publication stays broken", () => {
  const { layer, state } = makeDb(Number.POSITIVE_INFINITY)
  return Effect.gen(function* () {
    const index = yield* TicketIndex
    const publishing = yield* Effect.forkChild(
      index.upsertTicket(project, document).pipe(Effect.exit)
    )
    yield* TestClock.adjust("2 seconds")
    const exit = yield* Fiber.join(publishing)
    expect(exit._tag).toBe("Success")
    expect(state.attempts).toBe(6)
  }).pipe(Effect.provide(layerFor(layer)))
})

it.effect("reconciles a project whose publication never landed", () => {
  const { layer } = makeDb(Number.POSITIVE_INFINITY)
  const docs = { listIdsCalls: 0 }
  const docsLayer = Layer.succeed(TicketDocs, {
    listIds: () =>
      Effect.sync(() => {
        docs.listIdsCalls += 1
        return []
      })
  } as never)

  return Effect.gen(function* () {
    const index = yield* TicketIndex
    const publishing = yield* Effect.forkChild(
      index.upsertTicket(project, document)
    )
    yield* TestClock.adjust("2 seconds")
    yield* Fiber.join(publishing)
    expect(docs.listIdsCalls).toBe(0)

    yield* TestClock.adjust("6 seconds")
    expect(docs.listIdsCalls).toBeGreaterThan(0)
  }).pipe(Effect.provide(layerFor(layer, docsLayer)))
})

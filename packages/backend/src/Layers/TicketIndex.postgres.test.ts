import { randomUUID } from "node:crypto"
import { it } from "@effect/vitest"
import { describe, expect } from "vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import pg from "pg"
import { TicketId, TicketStatus } from "@projectproject/shared"
import { DbLive, PgLive } from "./Db"
import { TicketIndexLive } from "./TicketIndex"
import {
  TicketDocs,
  type TicketDocsShape,
  type TicketDocument
} from "../Services/TicketDocs"
import { TicketIndex } from "../Services/TicketIndex"

const { Client } = pg
const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)

const unexpected = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`unexpected ${method} call`))

const FakeTicketDocs = Layer.succeed(TicketDocs, {
  listIds: () => unexpected("TicketDocs.listIds"),
  read: () => unexpected("TicketDocs.read"),
  create: () => unexpected("TicketDocs.create"),
  write: () => unexpected("TicketDocs.write"),
  update: () => unexpected("TicketDocs.update"),
  remove: () => unexpected("TicketDocs.remove"),
  readRaw: () => unexpected("TicketDocs.readRaw")
} satisfies TicketDocsShape)

const DatabaseLive = DbLive.pipe(Layer.provideMerge(PgLive))
const TestLayer = TicketIndexLive.pipe(
  Layer.provide(FakeTicketDocs),
  Layer.provide(DatabaseLive)
)

const rebuiltDocument: TicketDocument = {
  id: ticketId("T-41"),
  title: "Restored ticket",
  status: ticketStatus("todo"),
  type: "other",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  assignees: [],
  archivedAt: null,
  createdBy: "test-user",
  createdAt: DateTime.toDate(DateTime.unsafeMake("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.unsafeMake("2026-01-01T00:00:00.000Z")),
  body: "# Restored ticket\n",
  commentsRegion: ""
}

const RebuildTicketDocs = Layer.succeed(TicketDocs, {
  listIds: () => Effect.succeed([rebuiltDocument.id]),
  read: () => Effect.succeed(rebuiltDocument),
  create: () => unexpected("TicketDocs.create"),
  write: () => unexpected("TicketDocs.write"),
  update: () => unexpected("TicketDocs.update"),
  remove: () => unexpected("TicketDocs.remove"),
  readRaw: () => unexpected("TicketDocs.readRaw")
} satisfies TicketDocsShape)

const RebuildTestLayer = TicketIndexLive.pipe(
  Layer.provide(RebuildTicketDocs),
  Layer.provide(DatabaseLive)
)

const withClient = <A>(use: (client: pg.Client) => Promise<A>) =>
  Effect.tryPromise(async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()
    try {
      return await use(client)
    } finally {
      await client.end()
    }
  }).pipe(Effect.orDie)

describe.runIf(process.env.DATABASE_URL !== undefined)(
  "TicketIndex Postgres",
  () => {
    it.scoped("reserves unique ticket numbers under concurrency", () =>
      Effect.gen(function* () {
        const suffix = randomUUID()
        const organizationId = `ticket-index-test-${suffix}`
        const orgSlug = `ticket-index-test-${suffix}`
        const projectSlug = `ticket-index-test-${suffix}`
        const projectId = randomUUID()
        yield* withClient(async (client) => {
          await client.query(
            `insert into organization (id, name, slug, created_at)
             values ($1, 'Ticket index test', $2, now())`,
            [organizationId, orgSlug]
          )
          await client.query(
            `insert into project_index
               (id, slug, organization_id, key, name, icon, color, created_by, created_at)
             values ($1, $2, $3, 'T', 'Ticket index test', 'folder', 'blue', 'test-user', now())`,
            [projectId, projectSlug, organizationId]
          )
        })
        yield* Effect.addFinalizer(() =>
          withClient((client) =>
            client.query("delete from organization where id = $1", [
              organizationId
            ])
          )
        )

        const index = yield* TicketIndex
        const project = yield* index.projectFor(orgSlug, projectSlug)
        const numbers = yield* Effect.forEach(
          Array.from({ length: 32 }),
          () => index.reserveTicketNumber(project),
          { concurrency: "unbounded" }
        )

        expect(numbers.toSorted((left, right) => left - right)).toEqual(
          Array.from({ length: 32 }, (_, value) => value + 1)
        )
      }).pipe(Effect.provide(TestLayer))
    )

    it.scoped("advances the counter when rebuilding from ticket files", () =>
      Effect.gen(function* () {
        const suffix = randomUUID()
        const organizationId = `ticket-index-rebuild-${suffix}`
        const orgSlug = `ticket-index-rebuild-${suffix}`
        const projectSlug = `ticket-index-rebuild-${suffix}`
        const projectId = randomUUID()
        yield* withClient(async (client) => {
          await client.query(
            `insert into organization (id, name, slug, created_at)
             values ($1, 'Ticket index rebuild', $2, now())`,
            [organizationId, orgSlug]
          )
          await client.query(
            `insert into project_index
               (id, slug, organization_id, key, name, icon, color, created_by, created_at)
             values ($1, $2, $3, 'T', 'Ticket index rebuild', 'folder', 'blue', 'test-user', now())`,
            [projectId, projectSlug, organizationId]
          )
        })
        yield* Effect.addFinalizer(() =>
          withClient((client) =>
            client.query("delete from organization where id = $1", [
              organizationId
            ])
          )
        )

        const index = yield* TicketIndex
        const project = yield* index.projectFor(orgSlug, projectSlug)
        yield* index.rebuildProject(project)

        expect(yield* index.reserveTicketNumber(project)).toBe(42)
      }).pipe(Effect.provide(RebuildTestLayer))
    )
  }
)

import { randomUUID } from "node:crypto"
import { it } from "@effect/vitest"
import { describe, expect } from "vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import pg from "pg"
import {
  encodeCursor,
  padNumericIdSort,
  TagName,
  TicketId,
  TicketStatus,
  type TicketFilter
} from "@projectproject/shared"
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
const tagName = Schema.decodeUnknownSync(TagName)

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
  createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  body: "# Restored ticket\n",
  commentsRegion: ""
}

const indexedDocument = (
  id: string,
  overrides: Partial<TicketDocument> = {}
): TicketDocument => ({
  ...rebuiltDocument,
  id: ticketId(id),
  title: id,
  createdAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  updatedAt: DateTime.toDate(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z")),
  ...overrides
})

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
    it.effect("reserves unique ticket numbers under concurrency", () =>
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

    it.effect("advances the counter when rebuilding from ticket files", () =>
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

    it.effect("queries, filters, paginates, and counts indexed tickets", () =>
      Effect.gen(function* () {
        const suffix = randomUUID()
        const organizationId = `ticket-index-query-${suffix}`
        const orgSlug = `ticket-index-query-${suffix}`
        const projectSlug = `ticket-index-query-${suffix}`
        const projectId = randomUUID()
        yield* withClient(async (client) => {
          await client.query(
            `insert into organization (id, name, slug, created_at)
             values ($1, 'Ticket index query', $2, now())`,
            [organizationId, orgSlug]
          )
          await client.query(
            `insert into project_index
               (id, slug, organization_id, key, name, icon, color, created_by, created_at)
             values ($1, $2, $3, 'T', 'Ticket index query', 'folder', 'blue', 'test-user', now())`,
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
        const januaryTenth = DateTime.toDate(
          DateTime.makeUnsafe("2026-01-10T00:00:00.000Z")
        )
        const januaryEleventh = DateTime.toDate(
          DateTime.makeUnsafe("2026-01-11T00:00:00.000Z")
        )
        const januaryTwelfth = DateTime.toDate(
          DateTime.makeUnsafe("2026-01-12T00:00:00.000Z")
        )
        const documents = [
          indexedDocument("T-2", {
            status: ticketStatus("todo"),
            priority: "low",
            tags: [tagName("backend")],
            assignees: ["viewer"],
            branch: "feat/T-2",
            updatedAt: januaryTenth
          }),
          indexedDocument("T-10", {
            title: "Alpha %_ literal",
            status: ticketStatus("in_progress"),
            type: "feat",
            priority: "high",
            updatedAt: januaryEleventh
          }),
          indexedDocument("T-11", {
            title: "Beta",
            status: ticketStatus("in_progress"),
            type: "bug",
            priority: "med",
            tags: [tagName("backend")],
            assignees: ["viewer"],
            branch: "feat/T-11",
            pr: 11,
            updatedAt: januaryTwelfth
          }),
          indexedDocument("T-12", {
            archivedAt: januaryTwelfth,
            updatedAt: januaryTwelfth
          }),
          indexedDocument("T-13", {
            title: "İstanbul",
            updatedAt: januaryTwelfth
          }),
          indexedDocument("T-14", {
            title: "istanbul",
            updatedAt: januaryTwelfth
          })
        ]
        yield* Effect.forEach(documents, (document) =>
          index.upsertTicket(project, document)
        )

        yield* index.markBranchStale(projectId, "feat/T-2", januaryTwelfth)
        expect(
          yield* index.getBranchDeletedAt(orgSlug, projectSlug, "T-2")
        ).toEqual(januaryTwelfth)
        expect(
          yield* index.getBranchDeletedAt(orgSlug, projectSlug, "T-10")
        ).toBeNull()
        expect(
          yield* index.getBranchDeletedAt("wrong-org", projectSlug, "T-2")
        ).toBeNull()
        expect(
          yield* index.getBranchDeletedAt(orgSlug, "wrong-project", "T-2")
        ).toBeNull()
        expect(
          yield* index.getBranchDeletedAt(orgSlug, projectSlug, "T-missing")
        ).toBeNull()

        const firstPage = yield* index.query(
          project,
          { sort: { key: "id", dir: "asc" } },
          { viewerId: "viewer", limit: 2 }
        )
        expect(firstPage.map(({ entry }) => entry.id)).toEqual(["T-2", "T-10"])

        const secondPage = yield* index.query(
          project,
          {
            sort: { key: "id", dir: "asc" },
            cursor: encodeCursor({
              id: "T-10",
              sort: padNumericIdSort("T-10")!
            })
          },
          { viewerId: "viewer", limit: 2 }
        )
        expect(secondPage.map(({ entry }) => entry.id)).toEqual([
          "T-11",
          "T-13"
        ])

        const included = yield* index.query(
          project,
          { sort: { key: "id", dir: "asc" } },
          {
            viewerId: "viewer",
            ticketIds: ["T-11", "T-2"],
            limit: 10
          }
        )
        expect(included.map(({ entry }) => entry.id)).toEqual(["T-2", "T-11"])

        const excluded = yield* index.query(
          project,
          { sort: { key: "id", dir: "asc" } },
          {
            viewerId: "viewer",
            excludeTicketIds: ["T-2", "T-10", "T-11", "T-13"],
            limit: 10
          }
        )
        expect(excluded.map(({ entry }) => entry.id)).toEqual(["T-14"])

        const filtered = yield* index.query(
          project,
          {
            sort: { key: "updated", dir: "desc" },
            filter: {
              status: [ticketStatus("in_progress")],
              assignee: ["mine"],
              tags: [tagName("backend")],
              hasBranch: true,
              hasPr: true,
              updatedAfter: januaryEleventh
            }
          },
          { viewerId: "viewer", limit: 10 }
        )
        expect(filtered.map(({ entry }) => entry.id)).toEqual(["T-11"])

        const filterCases: ReadonlyArray<{
          filter: TicketFilter
          expected: ReadonlyArray<string>
        }> = [
          {
            filter: { status: [ticketStatus("in_progress")] },
            expected: ["T-10", "T-11"]
          },
          { filter: { type: ["bug"] }, expected: ["T-11"] },
          {
            filter: { assignee: [null] },
            expected: ["T-10", "T-13", "T-14"]
          },
          {
            filter: { assignee: ["mine"] },
            expected: ["T-2", "T-11"]
          },
          { filter: { tags: [tagName("backend")] }, expected: ["T-2", "T-11"] },
          {
            filter: { hasBranch: false },
            expected: ["T-10", "T-13", "T-14"]
          },
          {
            filter: { hasPr: false },
            expected: ["T-2", "T-10", "T-13", "T-14"]
          },
          {
            filter: { updatedAfter: januaryEleventh },
            expected: ["T-11", "T-13", "T-14"]
          },
          { filter: { status: [] }, expected: [] },
          { filter: { tags: [] }, expected: [] }
        ]
        yield* Effect.forEach(filterCases, ({ filter, expected }) =>
          Effect.gen(function* () {
            const rows = yield* index.query(
              project,
              { filter, sort: { key: "id", dir: "asc" } },
              { viewerId: "viewer", limit: 10 }
            )
            expect(rows.map(({ entry }) => entry.id)).toEqual(expected)
          })
        )

        const literalSearch = yield* index.query(
          project,
          { q: "%_", sort: { key: "created", dir: "desc" } },
          { viewerId: "viewer", limit: 10 }
        )
        expect(literalSearch.map(({ entry }) => entry.id)).toEqual(["T-10"])

        const unicodeSearch = yield* index.query(
          project,
          { q: "İstanbul", sort: { key: "created", dir: "desc" } },
          { viewerId: "viewer", limit: 10 }
        )
        expect(unicodeSearch.map(({ entry }) => entry.id)).toEqual([
          "T-13",
          "T-14"
        ])

        const firstTitlePage = yield* index.query(
          project,
          { sort: { key: "title", dir: "asc" } },
          { viewerId: "viewer", limit: 3 }
        )
        expect(firstTitlePage.map(({ entry }) => entry.id)).toEqual([
          "T-10",
          "T-11",
          "T-13"
        ])

        const lastTitle = firstTitlePage.at(-1)!
        const secondTitlePage = yield* index.query(
          project,
          {
            sort: { key: "title", dir: "asc" },
            cursor: encodeCursor({
              id: lastTitle.entry.id,
              sort: lastTitle.sortValue
            })
          },
          { viewerId: "viewer", limit: 3 }
        )
        expect(secondTitlePage.map(({ entry }) => entry.id)).toEqual([
          "T-14",
          "T-2"
        ])

        const counts = yield* index.count(
          project,
          { filter: { tags: [tagName("backend")] } },
          { viewerId: "viewer" }
        )
        expect(counts).toEqual({
          total: 2,
          byStatus: { todo: 1, in_progress: 1 }
        })

        const archived = yield* index.query(
          project,
          {
            filter: { archived: true },
            sort: { key: "id", dir: "asc" }
          },
          { viewerId: "viewer", limit: 10 }
        )
        expect(archived.map(({ entry }) => entry.id)).toEqual(["T-12"])
      }).pipe(Effect.provide(TestLayer))
    )
  }
)

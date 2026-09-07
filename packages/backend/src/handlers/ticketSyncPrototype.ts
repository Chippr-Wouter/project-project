import * as Config from "effect/Config"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
  CurrentUser,
  NotFound,
  TicketSyncCheckpointPrototype,
  TicketId
} from "@projectproject/shared"
import { CurrentOrg } from "../Services/CurrentOrg"
import { Projects } from "../Services/Projects"
import { Tickets } from "../Services/Tickets"
import { TicketIndex } from "../Services/TicketIndex"
import { indexEntryToTicket } from "../Layers/Tickets"

const authorize = Effect.fn(function* (orgSlug: string, slug: string) {
  const enabled = yield* Config.boolean("TICKET_SYNC_PROTOTYPE").pipe(
    Config.withDefault(false),
    Effect.orDie
  )
  if (!enabled || orgSlug !== "measure" || slug !== "ten-thousand")
    return yield* new NotFound()
  const user = yield* CurrentUser
  const org = yield* CurrentOrg
  yield* org.resolve(orgSlug, user.id)
  const projects = yield* Projects
  yield* projects.requireMember(orgSlug, user.id, slug)
  return user
})

const head = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`SELECT epoch, revision FROM prototype_ticket_sync_head
    WHERE project_id = '00000000-0000-4000-8000-000000000010'`
  const decoded = yield* Schema.decodeUnknownEffect(
    Schema.Array(TicketSyncCheckpointPrototype)
  )(rows)
  if (!decoded[0]) return yield* Effect.die("Missing prototype sync head")
  return decoded[0]
})

export const syncSnapshotPrototype = Effect.fn(function* (
  orgSlug: string,
  slug: string
) {
  const user = yield* authorize(orgSlug, slug)
  const sql = yield* SqlClient.SqlClient
  const tickets = yield* Tickets
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`
        const checkpoint = yield* head
        const page = yield* tickets.list(
          orgSlug,
          user.id,
          slug,
          { sort: { key: "created", dir: "desc" } },
          10001
        )
        if (page.nextCursor)
          return yield* Effect.die("Prototype snapshot limit exceeded")
        return { checkpoint, items: page.items }
      })
    )
    .pipe(
      Effect.catchTag("SqlError", Effect.die),
      Effect.catchTag("SchemaError", Effect.die)
    )
})

export const syncDeltaPrototype = Effect.fn(function* (
  orgSlug: string,
  slug: string,
  since: typeof TicketSyncCheckpointPrototype.Type
) {
  const user = yield* authorize(orgSlug, slug)
  const sql = yield* SqlClient.SqlClient
  const index = yield* TicketIndex
  const projects = yield* Projects
  return yield* sql
    .withTransaction(
      Effect.gen(function* () {
        yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`
        const current = yield* head
        if (since.epoch !== current.epoch || since.revision > current.revision)
          return {
            checkpoint: current,
            items: [],
            deleted: [],
            reset: true,
            hasMore: false
          }
        const raw =
          yield* sql`SELECT revision, ticket_id AS id FROM prototype_ticket_sync_log
      WHERE project_id = '00000000-0000-4000-8000-000000000010'
      AND revision > ${since.revision} AND revision <= ${current.revision}
      ORDER BY revision LIMIT 1000`
        const changes = yield* Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ revision: Schema.Int, id: TicketId }))
        )(raw)
        const ids = [...new Set(changes.map((change) => change.id))]
        const project = yield* index.projectFor(orgSlug, slug)
        const entries = yield* index.list(project, ids)
        const github = yield* projects.getGithubIntegration(
          orgSlug,
          user.id,
          slug
        )
        const items = entries.map((entry) => indexEntryToTicket(entry, github))
        const present = new Set(items.map((item) => item.id))
        const revision = changes.at(-1)?.revision ?? since.revision
        return {
          checkpoint: { epoch: current.epoch, revision },
          items,
          deleted: ids.filter((id) => !present.has(id)),
          reset: false,
          hasMore: revision < current.revision
        }
      })
    )
    .pipe(
      Effect.catchTag("SqlError", Effect.die),
      Effect.catchTag("SchemaError", Effect.die)
    )
})

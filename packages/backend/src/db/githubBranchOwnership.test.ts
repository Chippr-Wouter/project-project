import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { PgClient } from "@effect/sql-pg"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Redacted from "effect/Redacted"
import { DbLive } from "../Layers/Db"
import { TicketIndexLive } from "../Layers/TicketIndex"
import { TicketDocs, type TicketDocsShape } from "../Services/TicketDocs"
import { TicketIndex } from "../Services/TicketIndex"

const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL

const unusedTicketDocs: TicketDocsShape = {
  listIds: () =>
    Effect.die(new Error("TicketDocs unavailable in ownership test")),
  read: () => Effect.die(new Error("TicketDocs unavailable in ownership test")),
  create: () =>
    Effect.die(new Error("TicketDocs unavailable in ownership test")),
  write: () =>
    Effect.die(new Error("TicketDocs unavailable in ownership test")),
  remove: () =>
    Effect.die(new Error("TicketDocs unavailable in ownership test")),
  readRaw: () =>
    Effect.die(new Error("TicketDocs unavailable in ownership test"))
}

describe.skipIf(!databaseUrl)("GitHub branch ownership", () => {
  const suffix = randomUUID()
  const organizationIds = [`ownership-a-${suffix}`, `ownership-b-${suffix}`]
  const projectIds = [randomUUID(), randomUUID()]
  const linkIds = [randomUUID(), randomUUID()]
  let pool: Pool
  let runtime: ManagedRuntime.ManagedRuntime<TicketIndex, never>

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required")
    const url = new URL(databaseUrl)
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/projectproject_effect_v4_")
    ) {
      throw new Error("Test requires an isolated local database")
    }
    pool = new Pool({ connectionString: databaseUrl })
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: `${import.meta.dirname}/migrations`
    })
    const pg = PgClient.layer({ url: Redacted.make(databaseUrl) })
    const db = DbLive.pipe(Layer.provideMerge(pg))
    runtime = ManagedRuntime.make(
      TicketIndexLive.pipe(
        Layer.provide(Layer.succeed(TicketDocs, unusedTicketDocs)),
        Layer.provide(db),
        Layer.orDie
      )
    )
    await pool.query(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ($1,$2,$1,now()),($3,$4,$3,now())",
      [organizationIds[0], "Ownership A", organizationIds[1], "Ownership B"]
    )
    await pool.query(
      "INSERT INTO project_index (id,slug,organization_id,key,name,icon,color,created_by) VALUES ($1,$2,$3,'A-1','A','folder','blue','test'),($4,$5,$6,'B-1','B','folder','blue','test')",
      [
        projectIds[0],
        `project-a-${suffix}`,
        organizationIds[0],
        projectIds[1],
        `project-b-${suffix}`,
        organizationIds[1]
      ]
    )
    await pool.query(
      "INSERT INTO organization_integration (id,organization_id,provider,status) VALUES ($1,$2,'github','active'),($3,$4,'github','active')",
      [linkIds[0], organizationIds[0], linkIds[1], organizationIds[1]]
    )
    await pool.query(
      "INSERT INTO project_integration_link (id,project_id,organization_id,organization_integration_id,provider,status) VALUES ($1,$2,$3,$1,'github','active'),($4,$5,$6,$4,'github','broken')",
      [
        linkIds[0],
        projectIds[0],
        organizationIds[0],
        linkIds[1],
        projectIds[1],
        organizationIds[1]
      ]
    )
    await pool.query(
      "INSERT INTO project_github_repository (project_integration_link_id,organization_id,status,repo_id,repo_owner,repo_name,default_branch) VALUES ($1,$2,'active','repo-shared','acme','shared','main'),($3,$4,'broken','repo-shared','acme','shared','main')",
      [linkIds[0], organizationIds[0], linkIds[1], organizationIds[1]]
    )
    await pool.query(
      "INSERT INTO ticket_index (organization_id,org_slug,project_id,project_slug,ticket_id,title,status,type,priority,branch,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,'T-1','A','todo','feat','med',NULL,'test',now(),now()),($5,$6,$7,$8,'T-1','B','todo','feat','med','feat/T-1','test',now(),now())",
      [
        organizationIds[0],
        organizationIds[0],
        projectIds[0],
        `project-a-${suffix}`,
        organizationIds[1],
        organizationIds[1],
        projectIds[1],
        `project-b-${suffix}`
      ]
    )
  })

  afterAll(async () => {
    await runtime?.dispose()
    if (pool) {
      await pool.query("DELETE FROM organization WHERE id = ANY($1)", [
        organizationIds
      ])
      await pool.end()
    }
  })

  it("checks ownership across organizations and ignores another repo", async () => {
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const index = yield* TicketIndex
        return {
          shared: yield* index.isRepositoryBranchAttached(
            "repo-shared",
            "feat/T-1"
          ),
          other: yield* index.isRepositoryBranchAttached(
            "repo-other",
            "feat/T-1"
          )
        }
      })
    )
    expect(result).toEqual({ shared: true, other: false })

    await pool.query(
      "UPDATE project_integration_link SET status='disconnected' WHERE id=$1",
      [linkIds[1]]
    )
    const disconnectedLink = await runtime.runPromise(
      Effect.gen(function* () {
        const index = yield* TicketIndex
        return yield* index.isRepositoryBranchAttached(
          "repo-shared",
          "feat/T-1"
        )
      })
    )
    expect(disconnectedLink).toBe(false)
    await pool.query(
      "UPDATE project_integration_link SET status='broken' WHERE id=$1",
      [linkIds[1]]
    )
    await pool.query(
      "UPDATE project_github_repository SET status='disconnected' WHERE project_integration_link_id=$1",
      [linkIds[1]]
    )
    const disconnected = await runtime.runPromise(
      Effect.gen(function* () {
        const index = yield* TicketIndex
        return yield* index.isRepositoryBranchAttached(
          "repo-shared",
          "feat/T-1"
        )
      })
    )
    expect(disconnected).toBe(false)

    await pool.query(
      "UPDATE project_github_repository SET status='broken' WHERE project_integration_link_id=$1",
      [linkIds[1]]
    )
    const broken = await runtime.runPromise(
      Effect.gen(function* () {
        const index = yield* TicketIndex
        return yield* index.isRepositoryBranchAttached(
          "repo-shared",
          "feat/T-1"
        )
      })
    )
    expect(broken).toBe(true)
  })
})

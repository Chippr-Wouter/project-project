import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { PgClient } from "@effect/sql-pg"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { Slug, TicketId, TicketStatus } from "@projectproject/shared"
import { DbLive } from "../Layers/Db"
import { ProjectsLive } from "../Layers/Projects"
import { TicketIndexLive } from "../Layers/TicketIndex"
import { GitHub } from "../Services/GitHub"
import { MarkdownError } from "../Services/Markdown"
import { ProjectDocs } from "../Services/ProjectDocs"
import { Projects } from "../Services/Projects"
import { TicketDocs, type TicketDocument } from "../Services/TicketDocs"
import { Users } from "../Services/Users"
import * as TicketDocumentLock from "../ticketDocumentLock"

const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL
const unused = () =>
  Effect.die(new Error("Unexpected repository switch dependency call"))

describe.skipIf(!databaseUrl)("GitHub repository switch", () => {
  const organizationId = randomUUID()
  const userId = randomUUID()
  const projectId = randomUUID()
  const integrationId = randomUUID()
  const linkId = randomUUID()
  const slug = Schema.decodeSync(Slug)(`switch-${projectId}`)
  const ticketId = Schema.decodeSync(TicketId)("T-1")
  const createdAt = DateTime.toDateUtc(
    DateTime.makeUnsafe("2026-09-08T00:00:00Z")
  )
  const initialTicket: TicketDocument = {
    id: ticketId,
    title: "Keep branch, clear old PR",
    status: Schema.decodeSync(TicketStatus)("todo"),
    type: "feat",
    priority: "med",
    tags: [],
    branch: "feat/T-1",
    pr: 42,
    prState: "open",
    lastTransitionedPr: 41,
    assignees: [],
    archivedAt: null,
    createdBy: userId,
    createdAt,
    updatedAt: createdAt,
    commentsRegion: "",
    body: "Ticket body"
  }
  let ticket = initialTicket
  let failWrite = false
  let lockChecks = 0
  let pool: Pool
  let runtime: ManagedRuntime.ManagedRuntime<Projects, never>

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
    await pool.query(
      'INSERT INTO "user" (id,name,email,created_at,updated_at) VALUES ($1,$1,$2,now(),now())',
      [userId, `${userId}@example.test`]
    )
    await pool.query(
      "INSERT INTO organization (id,name,slug,created_at) VALUES ($1,$1,$1,now())",
      [organizationId]
    )
    await pool.query(
      "INSERT INTO member (id,organization_id,user_id,role,created_at) VALUES ($1,$2,$3,'owner',now())",
      [randomUUID(), organizationId, userId]
    )
    await pool.query(
      "INSERT INTO project_index (id,slug,organization_id,key,name,icon,color,created_by) VALUES ($1,$2,$3,'T','Switch','folder','#3b82f6',$4)",
      [projectId, slug, organizationId, userId]
    )
    await pool.query(
      "INSERT INTO organization_integration (id,organization_id,provider,status) VALUES ($1,$2,'github','active')",
      [integrationId, organizationId]
    )
    await pool.query(
      "INSERT INTO organization_github_integration (organization_integration_id,installation_id,github_account_id,github_account_login,github_account_type) VALUES ($1,$2,'account','acme','Organization')",
      [integrationId, `installation-${integrationId}`]
    )
    await pool.query(
      "INSERT INTO project_integration_link (id,project_id,organization_id,organization_integration_id,provider,status) VALUES ($1,$2,$3,$4,'github','active')",
      [linkId, projectId, organizationId, integrationId]
    )
    await pool.query(
      "INSERT INTO project_github_repository (project_integration_link_id,organization_id,status,repo_id,repo_owner,repo_name,default_branch) VALUES ($1,$2,'active','old-repo','acme','old','main')",
      [linkId, organizationId]
    )

    const db = DbLive.pipe(
      Layer.provideMerge(
        PgClient.layer({
          url: Redacted.make(databaseUrl),
          maxConnections: 1
        })
      )
    )
    const docs = Layer.succeed(TicketDocs, {
      listIds: () => Effect.succeed([ticketId]),
      read: () => Effect.sync(() => ticket),
      write: (_org, _slug, _id, next) =>
        Effect.gen(function* () {
          if (failWrite) {
            return yield* new MarkdownError({
              message: "Write failed",
              cause: new Error("Test failure")
            })
          }
          ticket = next
          return yield* Effect.void
        }),
      update: (_org, _slug, _id, transform, onPersist) =>
        Effect.gen(function* () {
          const next = yield* transform(ticket)
          if (failWrite)
            return yield* new MarkdownError({
              message: "Write failed",
              cause: new Error("Test failure")
            })
          ticket = next
          if (onPersist) yield* onPersist(next)
          return next
        }),
      create: unused,
      remove: unused,
      readRaw: unused
    })
    const lock = Layer.effect(
      TicketDocumentLock.TicketDocumentLock,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const delegate = TicketDocumentLock.make()
        return TicketDocumentLock.TicketDocumentLock.of({
          withRepositoryBranchLock: delegate.withRepositoryBranchLock,
          withTicketDocumentLock: (org, project, id, effect) =>
            Effect.gen(function* () {
              const transaction = yield* Effect.serviceOption(
                sql.transactionService
              )
              expect(Option.isNone(transaction)).toBe(true)
              lockChecks += 1
              return yield* delegate.withTicketDocumentLock(
                org,
                project,
                id,
                effect
              )
            })
        })
      })
    ).pipe(Layer.provide(db))
    runtime = ManagedRuntime.make(
      ProjectsLive.pipe(
        Layer.provide(
          TicketIndexLive.pipe(Layer.provide(db), Layer.provide(docs))
        ),
        Layer.provide(docs),
        Layer.provide(lock),
        Layer.provide(db),
        Layer.provide(
          Layer.succeed(ProjectDocs, {
            read: () =>
              Effect.succeed({
                slug,
                name: "Switch",
                icon: "folder",
                color: "#3b82f6",
                createdAt: initialTicket.createdAt,
                members: [],
                github: null,
                setup: {
                  workflowReviewedAt: null,
                  invitePeopleDismissedAt: null,
                  connectGithubDismissedAt: null
                },
                body: "Project body"
              }),
            write: () => Effect.void,
            removeDir: unused,
            readRaw: unused
          })
        ),
        Layer.provide(
          Layer.succeed(Users, {
            findByEmail: unused,
            findManyByIds: unused,
            fullByIds: unused
          })
        ),
        Layer.provide(
          Layer.succeed(GitHub, {
            verifyInstallationRepo: () =>
              Effect.succeed({
                repoId: "new-repo",
                owner: "acme",
                name: "new",
                defaultBranch: "main"
              }),
            getInstallationAccount: unused,
            listInstallationRepos: unused,
            exchangeAppUserCode: unused,
            appUserCanAccessInstallation: unused,
            createBranchAsUser: unused,
            openPullRequestAsUser: unused,
            fetchInstallationProjectStates: unused,
            listInstallationBranches: unused,
            branchExistsInstallation: unused
          })
        ),
        Layer.orDie
      )
    )
  })

  afterAll(async () => {
    await runtime?.dispose()
    if (pool) {
      await pool.query("DELETE FROM organization WHERE id=$1", [organizationId])
      await pool.query('DELETE FROM "user" WHERE id=$1', [userId])
      await pool.end()
    }
  })

  const connect = () =>
    runtime.runPromise(
      Effect.flatMap(Projects, (projects) =>
        projects.connectGithub(organizationId, userId, slug, {
          repoId: "new-repo",
          repoOwner: "acme",
          repoName: "new"
        })
      )
    )

  it("keeps the old connection on cleanup failure and retries outside a transaction", async () => {
    failWrite = true
    await expect(connect()).rejects.toMatchObject({ _tag: "MarkdownError" })
    const failed = await pool.query(
      "SELECT repo_id FROM project_github_repository WHERE organization_id=$1 AND status='active'",
      [organizationId]
    )
    expect(failed.rows).toEqual([{ repo_id: "old-repo" }])

    failWrite = false
    const result = await connect()
    expect(result.github?.repoId).toBe("new-repo")
    expect(lockChecks).toBe(2)
    expect(ticket).toMatchObject({
      branch: "feat/T-1",
      pr: null,
      prState: null,
      lastTransitionedPr: null
    })
    const indexed = await pool.query(
      "SELECT branch,pr,pr_state,last_transitioned_pr FROM ticket_index WHERE project_id=$1 AND ticket_id=$2",
      [projectId, ticketId]
    )
    expect(indexed.rows).toEqual([
      {
        branch: "feat/T-1",
        pr: null,
        pr_state: null,
        last_transitioned_pr: null
      }
    ])
  })
})

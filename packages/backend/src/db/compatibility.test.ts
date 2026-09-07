import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { eq } from "drizzle-orm"
import { PgClient } from "@effect/sql-pg"
import { DateTime, Effect, Layer, ManagedRuntime, Redacted } from "effect"
import { DbLive } from "../Layers/Db"
import { Db } from "../Services/Db"
import { relations, user } from "./schema"
import type { SqlError } from "effect/unstable/sql/SqlError"

const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)(
  "Promise and Effect database compatibility",
  () => {
    const id = randomUUID()
    let pool: Pool
    let runtime: ManagedRuntime.ManagedRuntime<Db, SqlError>

    beforeAll(async () => {
      if (!databaseUrl) throw new Error("Test database URL is required")
      const url = new URL(databaseUrl)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.startsWith("/projectproject_effect_v4_")
      ) {
        throw new Error(
          "Database compatibility tests require an isolated local test database"
        )
      }
      pool = new Pool({ connectionString: databaseUrl })
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: `${import.meta.dirname}/migrations`
      })
      runtime = ManagedRuntime.make(
        DbLive.pipe(
          Layer.provide(PgClient.layer({ url: Redacted.make(databaseUrl) }))
        )
      )
    })

    afterAll(async () => {
      if (pool) {
        await pool.query('DELETE FROM "user" WHERE id = $1', [id])
        await pool.end()
      }
      await runtime?.dispose()
    })

    it("reads Promise inserts through Effect and preserves timestamp types", async () => {
      const promiseDb = drizzle({ client: pool, relations })
      const now = DateTime.toDate(
        DateTime.makeUnsafe("2026-09-07T12:34:56.000Z")
      )
      await promiseDb.insert(user).values({
        id,
        name: "Driver compatibility",
        email: `${id}@example.test`,
        createdAt: now,
        updatedAt: now
      })
      const row = await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* Db
          return yield* db.query.user.findFirst({ where: { id } })
        })
      )
      expect(row?.createdAt).toEqual(now)
      expect(row?.updatedAt).toEqual(now)
      expect(row?.name).toBe("Driver compatibility")
    })

    it("reads Effect updates through the Promise driver and rolls back failed transactions", async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const db = yield* Db
          yield* db
            .update(user)
            .set({ name: "Effect update" })
            .where(eq(user.id, id))
          const result = yield* Effect.exit(
            db.transaction(() =>
              Effect.gen(function* () {
                yield* db
                  .update(user)
                  .set({ name: "Rolled back" })
                  .where(eq(user.id, id))
                return yield* Effect.fail("rollback")
              })
            )
          )
          expect(result._tag).toBe("Failure")
        })
      )
      const row = await drizzle({
        client: pool,
        relations
      }).query.user.findFirst({ where: { id } })
      expect(row?.name).toBe("Effect update")
    })
  }
)

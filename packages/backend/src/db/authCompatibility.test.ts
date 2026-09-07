import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { magicLink } from "better-auth/plugins"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import * as schema from "./schema"
import * as authSchema from "./auth-schema"

const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("Better Auth session compatibility", () => {
  const id = randomUUID()
  let pool: Pool

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
    await pool.query(
      'INSERT INTO "user" (id,name,email,created_at,updated_at) VALUES ($1,$2,$3,now(),now())',
      [id, "Auth test", `${id}@example.test`]
    )
  })

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM "user" WHERE id = $1', [id])
      await pool.end()
    }
  })

  it("signs in and revokes a Better Auth session through the Promise driver", async () => {
    let signInUrl = ""
    const testAuth = betterAuth({
      baseURL: "http://localhost:15999",
      secret: "isolated-effect-v4-auth-compatibility-test-secret",
      database: drizzleAdapter(drizzle({ client: pool, schema }), {
        provider: "pg",
        schema: authSchema
      }),
      plugins: [
        magicLink({
          sendMagicLink: async ({ url }) => {
            signInUrl = url
          }
        })
      ]
    })
    await testAuth.api.signInMagicLink({
      body: { email: `${id}@example.test` },
      headers: new Headers({ origin: "http://localhost:15999" })
    })
    expect(signInUrl).not.toBe("")
    const response = await testAuth.handler(new Request(signInUrl))
    expect(response.status).toBe(302)
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    const headers = new Headers({ cookie, origin: "http://localhost:15999" })
    const session = await testAuth.api.getSession({ headers })
    expect(session?.user.id).toBe(id)
    expect(session?.session.expiresAt).toBeInstanceOf(Date)
    await testAuth.api.signOut({ headers })
    expect(await testAuth.api.getSession({ headers })).toBeNull()
  })
})

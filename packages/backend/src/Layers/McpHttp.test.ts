import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { FileSystem } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { McpHttp } from "../Services/McpHttp"

const databaseUrl = process.env.PROJECTPROJECT_MCP_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("stateless MCP", () => {
  const userIds = [randomUUID(), randomUUID()]
  const tokens = [randomUUID(), randomUUID()]
  const clientId = randomUUID()
  const orgId = randomUUID()
  const resource = "http://localhost:15999/mcp"
  const clients: Array<Client> = []
  let pool: Pool
  let filesystem: FileSystem.FileSystem
  let projectsDir: string
  let dispose: (() => Promise<void>) | undefined
  let handlers: Array<(request: Request) => Promise<Response>> = []
  let requestCount = 0

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required")
    const url = new URL(databaseUrl)
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/projectproject_mcp_test")
    ) {
      throw new Error("MCP tests require an isolated local database")
    }
    pool = new Pool({ connectionString: databaseUrl })
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: `${import.meta.dirname}/../db/migrations`
    })
    filesystem = await Effect.runPromise(
      Effect.provide(FileSystem.FileSystem, BunContext.layer)
    )
    projectsDir = await Effect.runPromise(
      filesystem.makeTempDirectory({ prefix: "projectproject-mcp-test-" })
    )
    for (const [key, value] of Object.entries({
      DATABASE_URL: databaseUrl,
      PROJECTS_DIR: projectsDir,
      BETTER_AUTH_URL: "http://localhost:15999",
      BETTER_AUTH_SECRET: "isolated-stateless-mcp-test-secret-value",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----test",
      GITHUB_APP_CLIENT_ID: "test",
      GITHUB_APP_CLIENT_SECRET: "test"
    }))
      vi.stubEnv(key, value)
    await pool.query(
      "INSERT INTO oauth_application (id,client_id,name,created_at,updated_at) VALUES ($1,$1,$2,now(),now())",
      [clientId, "Stateless test"]
    )
    await pool.query(
      "INSERT INTO organization (id,name,slug,created_at) VALUES ($1,$2,$1,now())",
      [orgId, "Private organization"]
    )
    for (const [index, id] of userIds.entries()) {
      await pool.query(
        'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$2,$3,true,now(),now())',
        [id, "MCP test", `${id}@example.test`]
      )
      await pool.query(
        "INSERT INTO oauth_access_token (id,access_token,client_id,user_id,access_token_expires_at,created_at,updated_at) VALUES ($1,$1,$2,$3,now()+interval '1 hour',now(),now())",
        [tokens[index], clientId, id]
      )
    }
    const { McpHttpLive } = await import("./McpHttp")
    const { McpServerLive } = await import("./McpServer")
    const layer = McpHttpLive.pipe(Layer.provide(McpServerLive))
    const runtimes = [ManagedRuntime.make(layer), ManagedRuntime.make(layer)]
    dispose = async () => {
      await Promise.all(runtimes.map((runtime) => runtime.dispose()))
    }
    handlers = await Promise.all(
      runtimes.map(
        async (runtime) => (await runtime.runPromise(McpHttp)).handle
      )
    )
  })

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()))
    await dispose?.()
    if (projectsDir)
      await Effect.runPromise(
        filesystem.remove(projectsDir, { recursive: true, force: true })
      )
    if (pool) {
      await pool.query("DELETE FROM oauth_application WHERE client_id=$1", [
        clientId
      ])
      await pool.query('DELETE FROM "user" WHERE id=ANY($1)', [userIds])
      await pool.query("DELETE FROM organization WHERE id=$1", [orgId])
      await pool.end()
    }
    vi.unstubAllEnvs()
  })

  it("routes independent authenticated calls across handlers without sharing user context", async () => {
    for (const token of tokens) {
      const client = new Client({ name: "stateless-test", version: "1" })
      clients.push(client)
      const transport = new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: async (input, init) => {
          const request = new Request(input.toString(), init)
          expect(request.headers.get("mcp-session-id")).toBeNull()
          const handler = handlers[requestCount++ % handlers.length]
          const response = await handler(request)
          expect(response.headers.get("mcp-session-id")).toBeNull()
          return response
        }
      })
      await client.connect(transport)
      expect(transport.sessionId).toBeUndefined()
    }
    const first = clients[0]
    expect(
      (await first.listTools()).tools.some((tool) => tool.name === "me")
    ).toBe(true)
    await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const userIndex = index % clients.length
        expect(
          await clients[userIndex].callTool({ name: "me", arguments: {} })
        ).toMatchObject({
          content: [
            { type: "text", text: expect.stringContaining(userIds[userIndex]) }
          ]
        })
      })
    )
    expect(
      await first.callTool({ name: "get_org", arguments: { orgSlug: orgId } })
    ).toMatchObject({ isError: true })
    const unauthorized = await handlers[0](
      new Request(resource, { method: "POST" })
    )
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers.get("www-authenticate")).toContain("Bearer")
    for (const method of ["GET", "DELETE"]) {
      const response = await handlers[0](
        new Request(resource, {
          method,
          headers: { authorization: `Bearer ${tokens[0]}` }
        })
      )
      expect(response.status).toBe(405)
      expect(response.headers.get("allow")).toBe("POST")
    }
    await pool.query("DELETE FROM oauth_access_token WHERE access_token=$1", [
      tokens[0]
    ])
    await expect(first.listTools()).rejects.toThrow()
    expect(
      await clients[1].callTool({ name: "me", arguments: {} })
    ).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining(userIds[1]) }]
    })
  })
})

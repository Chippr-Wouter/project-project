import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test"
import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Clock, FileSystem } from "effect"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer, type Server } from "node:http"
import { toNodeHandler } from "better-auth/node"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv"
import { McpTools } from "@projectproject/shared"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { McpHttp } from "../Services/McpHttp"

const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL

describe.skipIf(!databaseUrl)("stateless MCP", () => {
  const userIds = [randomUUID(), randomUUID()]
  const tokens: string[] = []
  const consentIds = [randomUUID(), randomUUID()]
  const clientId = randomUUID()
  const orgId = randomUUID()
  let expiredToken: string
  let resource: string
  let server: Server
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
      !url.pathname.startsWith("/projectproject_effect_v4_")
    ) {
      throw new Error("MCP tests require an isolated local database")
    }
    pool = new Pool({ connectionString: databaseUrl })
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: `${import.meta.dirname}/../db/migrations`
    })
    filesystem = await Effect.runPromise(
      Effect.provide(FileSystem.FileSystem, BunFileSystem.layer)
    )
    projectsDir = await Effect.runPromise(
      filesystem.makeTempDirectory({ prefix: "projectproject-mcp-test-" })
    )
    server = createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("Missing test server address")
    const baseUrl = `http://127.0.0.1:${address.port}`
    resource = `${baseUrl}/mcp`
    for (const [key, value] of Object.entries({
      DATABASE_URL: databaseUrl,
      PROJECTS_DIR: projectsDir,
      BETTER_AUTH_URL: baseUrl,
      MCP_RESOURCE_URL: baseUrl,
      BETTER_AUTH_SECRET: "isolated-effect-v4-oauth-compatibility-test-secret",
      GITHUB_APP_ID: "123",
      GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----test",
      GITHUB_APP_CLIENT_ID: "test",
      GITHUB_APP_CLIENT_SECRET: "test"
    }))
      vi.stubEnv(key, value)
    await pool.query(
      "INSERT INTO oauth_client (id,client_id,name,redirect_uris,created_at) VALUES ($1,$1,$2,ARRAY['http://localhost/callback'],now())",
      [clientId, "Stateless test"]
    )
    await pool.query(
      "INSERT INTO organization (id,name,slug,created_at) VALUES ($1,$2,$1,now())",
      [orgId, "Private organization"]
    )
    const { auth } = await import("../auth")
    server.on("request", toNodeHandler(auth))
    for (const [index, id] of userIds.entries()) {
      await pool.query(
        'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$2,$3,true,now(),now())',
        [id, "MCP test", `${id}@example.test`]
      )
      await pool.query(
        "INSERT INTO oauth_provider_consent (id,client_id,user_id,scopes,created_at,updated_at) VALUES ($1,$2,$3,ARRAY['openid'],now(),now())",
        [consentIds[index], clientId, id]
      )
      const signed = await auth.api.signJWT({
        body: {
          payload: {
            sub: id,
            client_id: clientId,
            pp_consent_ids: [consentIds[index]],
            aud: resource,
            iss: `${baseUrl}/api/auth`,
            exp:
              Math.floor(
                (await Effect.runPromise(Clock.currentTimeMillis)) / 1000
              ) + 3600
          }
        }
      })
      tokens.push(signed.token)
      if (index === 0) {
        expiredToken = (
          await auth.api.signJWT({
            body: {
              payload: {
                sub: id,
                client_id: clientId,
                pp_consent_ids: [consentIds[index]],
                aud: resource,
                iss: `${baseUrl}/api/auth`,
                exp:
                  Math.floor(
                    (await Effect.runPromise(Clock.currentTimeMillis)) / 1000
                  ) - 3600
              }
            }
          })
        ).token
      }
    }
    const { McpHttpLive } = await import("./McpHttp")
    const { McpServerLive } = await import("./McpServer")
    const { DbLive, PgLive } = await import("./Db")
    const layer = McpHttpLive.pipe(
      Layer.provide(McpServerLive),
      Layer.provide(DbLive.pipe(Layer.provide(PgLive)))
    )
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
      await pool.query("DELETE FROM oauth_client WHERE client_id=$1", [
        clientId
      ])
      await pool.query('DELETE FROM "user" WHERE id=ANY($1)', [userIds])
      await pool.query("DELETE FROM organization WHERE id=$1", [orgId])
      await pool.end()
    }
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
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
    const { tools } = await first.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      Object.keys(McpTools).sort()
    )
    const jsonSchema = new AjvJsonSchemaValidator()
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object")
      const validate = jsonSchema.getValidator(tool.inputSchema)
      expect(validate([]).valid).toBe(false)
      if (tool.name === "me") expect(validate({}).valid).toBe(true)
      if (tool.name === "create_ticket") {
        expect(
          validate({
            orgSlug: "acme",
            projectSlug: "demo",
            title: "Valid ticket"
          }).valid
        ).toBe(true)
        expect(
          validate({ orgSlug: "acme", projectSlug: "demo", title: "" }).valid
        ).toBe(false)
      }
    }
    await expect(
      first.callTool({ name: "not_a_tool", arguments: {} })
    ).rejects.toMatchObject({ code: -32602 })
    expect(
      await first.callTool({
        name: "create_ticket",
        arguments: {
          orgSlug: "acme",
          projectSlug: "demo",
          title: ""
        }
      })
    ).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: expect.stringContaining("Validation error") }
      ]
    })
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
    expect(
      (
        await handlers[0](
          new Request(resource, {
            method: "POST",
            headers: { authorization: `Bearer ${expiredToken}` }
          })
        )
      ).status
    ).toBe(401)
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
    await pool.query("DELETE FROM oauth_provider_consent WHERE id=$1", [
      consentIds[0]
    ])
    await expect(first.listTools()).rejects.toThrow()
    expect(
      await clients[1].callTool({ name: "me", arguments: {} })
    ).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining(userIds[1]) }]
    })
  })
})

import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test"
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer, type Server } from "node:http"
import { createHash, randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { betterAuth } from "better-auth"
import { toNodeHandler } from "better-auth/node"
import { makeSignature } from "better-auth/crypto"
import { requireMcpAuth } from "@better-auth/mcp"
import { FileSystem } from "@effect/platform"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import { McpHttp } from "../Services/McpHttp"
import * as authSchema from "./auth-schema"

const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL
const Client = Schema.Struct({ client_id: Schema.String })
const Redirect = Schema.Struct({ url: Schema.String })
const Token = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String
})

describe.skipIf(!databaseUrl)("MCP OAuth provider compatibility", () => {
  let server: Server
  let pool: Pool
  let baseUrl: string
  let auth: typeof import("../auth").auth
  let cookie: string
  let clientId: string | undefined
  let projectsDir: string
  let filesystem: FileSystem.FileSystem
  let handleMcp: (request: Request) => Promise<Response>
  let disposeMcp = async () => {}
  const migratedClientId = randomUUID()
  const unrelatedClientId = randomUUID()
  const userId = randomUUID()
  const secret = "isolated-effect-v4-oauth-compatibility-test-secret"

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required")
    const url = new URL(databaseUrl)
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/projectproject_effect_v4_")
    ) {
      throw new Error("OAuth tests require an isolated local test database")
    }
    pool = new Pool({ connectionString: databaseUrl })
    await migrate(drizzle({ client: pool, schema: authSchema }), {
      migrationsFolder: `${import.meta.dirname}/migrations`
    })
    server = createServer()
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string")
      throw new Error("Missing test server address")
    baseUrl = `http://127.0.0.1:${address.port}`
    vi.stubEnv("DATABASE_URL", databaseUrl)
    vi.stubEnv("BETTER_AUTH_URL", baseUrl)
    vi.stubEnv("MCP_RESOURCE_URL", baseUrl)
    vi.stubEnv("BETTER_AUTH_SECRET", secret)
    filesystem = await Effect.runPromise(
      FileSystem.FileSystem.pipe(Effect.provide(BunFileSystem.layer))
    )
    projectsDir = await Effect.runPromise(
      filesystem.makeTempDirectory({
        prefix: "projectproject-effect-v4-oauth-"
      })
    )
    vi.stubEnv("PROJECTS_DIR", projectsDir)
    vi.stubEnv("GITHUB_APP_ID", "123")
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "-----BEGIN PRIVATE KEY-----test")
    vi.stubEnv("GITHUB_APP_CLIENT_ID", "test")
    vi.stubEnv("GITHUB_APP_CLIENT_SECRET", "test")
    await pool.query(
      "INSERT INTO oauth_application (id, client_id, redirect_urls) VALUES ($1, $1, $2)",
      [migratedClientId, "http://127.0.0.1:15998/callback"]
    )
    await pool.query(
      `INSERT INTO oauth_client (id, client_id, redirect_uris, token_endpoint_auth_method, grant_types, response_types, require_pkce)
       VALUES ($1, $1, $2, 'none', $3, $4, true)`,
      [
        migratedClientId,
        ["http://127.0.0.1:15998/callback"],
        ["authorization_code", "refresh_token"],
        ["code"]
      ]
    )
    auth = (await import("../auth")).auth
    const { McpHttpLive } = await import("../Layers/McpHttp")
    const { McpServerLive } = await import("../Layers/McpServer")
    const { DbLive, PgLive } = await import("../Layers/Db")
    const runtime = ManagedRuntime.make(
      McpHttpLive.pipe(
        Layer.provide(McpServerLive),
        Layer.provide(DbLive.pipe(Layer.provide(PgLive))),
        Layer.provide(Layer.scope)
      )
    )
    disposeMcp = () => runtime.dispose()
    handleMcp = (await runtime.runPromise(McpHttp)).handle
    server.on("request", toNodeHandler(auth))
    await pool.query(
      'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$2,$3,true,now(),now())',
      [userId, "OAuth Test", `${userId}@example.test`]
    )
    const context = await auth.$context
    const session = await context.internalAdapter.createSession(userId)
    if (!session) throw new Error("Failed to create test session")
    cookie = `better-auth.session_token=${encodeURIComponent(`${session.token}.${await makeSignature(session.token, secret)}`)}`
  })

  afterAll(async () => {
    const results = await Promise.allSettled([
      disposeMcp(),
      projectsDir
        ? Effect.runPromise(
            filesystem.remove(projectsDir, { recursive: true, force: true })
          )
        : Promise.resolve(),
      (async () => {
        if (!pool) return
        try {
          const deletions = await Promise.allSettled([
            pool.query(
              "DELETE FROM oauth_client WHERE client_id IN ($1, $2, $3)",
              [clientId, unrelatedClientId, migratedClientId]
            ),
            pool.query("DELETE FROM oauth_application WHERE client_id=$1", [
              migratedClientId
            ]),
            pool.query('DELETE FROM "user" WHERE id=$1', [userId])
          ])
          for (const result of deletions)
            if (result.status === "rejected") throw result.reason
        } finally {
          await pool.end()
        }
      })(),
      server
        ? new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
        : Promise.resolve()
    ])
    vi.unstubAllEnvs()
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : []
    )
    if (errors.length)
      throw new AggregateError(errors, "OAuth test cleanup failed")
  })

  it("links migrated clients once across repeated auth initialization", async () => {
    const before = await pool.query(
      "SELECT id, resource_id FROM oauth_client_resource WHERE client_id=$1",
      [migratedClientId]
    )
    expect(before.rows).toEqual([
      { id: expect.any(String), resource_id: `${baseUrl}/mcp` }
    ])
    await betterAuth(auth.options).$context
    const after = await pool.query(
      "SELECT id, resource_id FROM oauth_client_resource WHERE client_id=$1",
      [migratedClientId]
    )
    expect(after.rows).toEqual(before.rows)
  })

  it("migrates malformed legacy metadata without copying clients missing redirects", async () => {
    const migration = await Effect.runPromise(
      filesystem.readFileString(
        `${import.meta.dirname}/migrations/0029_better_auth_17.sql`
      )
    )
    const backfill = migration
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes('INSERT INTO "oauth_client"'))
    if (!backfill) throw new Error("Missing client backfill")
    const connection = await pool.connect()
    try {
      await connection.query("BEGIN")
      await connection.query(
        "CREATE TEMP TABLE oauth_application (LIKE public.oauth_application INCLUDING ALL) ON COMMIT DROP"
      )
      await connection.query(
        "CREATE TEMP TABLE oauth_client (LIKE public.oauth_client INCLUDING ALL) ON COMMIT DROP"
      )
      await connection.query(`INSERT INTO oauth_application (id, client_id, redirect_urls, metadata) VALUES
        ('valid', 'valid', 'http://localhost/callback', '{"ok":true}'),
        ('malformed', 'malformed', 'http://localhost/callback', '{broken'),
        ('null', 'null', NULL, NULL),
        ('empty', 'empty', '', ''),
        ('whitespace', 'whitespace', '  ', '')`)
      await connection.query(backfill)
      const result = await connection.query(
        "SELECT id, metadata, redirect_uris FROM oauth_client ORDER BY id"
      )
      expect(result.rows).toEqual([
        {
          id: "malformed",
          metadata: { legacy: "{broken" },
          redirect_uris: ["http://localhost/callback"]
        },
        {
          id: "valid",
          metadata: { ok: true },
          redirect_uris: ["http://localhost/callback"]
        }
      ])
    } finally {
      await connection.query("ROLLBACK")
      connection.release()
    }
  })

  it("discovers, registers, and reauthorizes migrated clients with resource-bound PKCE tokens", async () => {
    const discovery = await fetch(
      `${baseUrl}/.well-known/oauth-authorization-server/api/auth`
    )
    expect(discovery.status).toBe(200)
    const metadata = Schema.decodeUnknownSync(
      Schema.Struct({
        authorization_endpoint: Schema.String,
        token_endpoint: Schema.String,
        registration_endpoint: Schema.String
      })
    )(await discovery.json())
    expect(metadata.authorization_endpoint).toBe(
      `${baseUrl}/api/auth/oauth2/authorize`
    )
    const resource = `${baseUrl}/mcp`
    const resourceMetadata = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp`
    )
    expect(resourceMetadata.status).toBe(200)
    const protectedMetadata = Schema.decodeUnknownSync(
      Schema.Struct({
        resource: Schema.String,
        authorization_servers: Schema.Array(Schema.String)
      })
    )(await resourceMetadata.json())
    expect(protectedMetadata.resource).toBe(resource)
    expect(protectedMetadata.authorization_servers).toContain(
      `${baseUrl}/api/auth`
    )
    const registration = await fetch(metadata.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Migration test",
        application_type: "native",
        redirect_uris: ["http://127.0.0.1:15998/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"]
      })
    })
    expect(registration.status, await registration.clone().text()).toBe(201)
    clientId = Schema.decodeUnknownSync(Client)(
      await registration.json()
    ).client_id
    await pool.query(
      "INSERT INTO oauth_client (id, client_id, redirect_uris, user_id) VALUES ($1, $1, $2, $3)",
      [unrelatedClientId, ["http://localhost/unrelated"], userId]
    )
    await pool.query(
      "INSERT INTO oauth_provider_consent (id, client_id, user_id, scopes, created_at, updated_at) VALUES ($1, $1, $2, $3, now(), now())",
      [unrelatedClientId, userId, ["openid"]]
    )
    const registrationMapping = await pool.query(
      "SELECT resource_id FROM oauth_client_resource WHERE client_id=$1",
      [clientId]
    )
    expect(registrationMapping.rows).toEqual([{ resource_id: resource }])
    await pool.query("DELETE FROM oauth_client WHERE client_id=$1", [clientId])
    clientId = migratedClientId
    const verifier =
      "effect-v4-migration-pkce-verifier-0123456789-abcdefghijklmnopqrstuvwxyz"
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://127.0.0.1:15998/callback",
      response_type: "code",
      scope: "openid profile offline_access",
      resource,
      state: "roundtrip-state",
      code_challenge_method: "S256",
      code_challenge: createHash("sha256").update(verifier).digest("base64url")
    })
    const authorization = await auth.handler(
      new Request(`${metadata.authorization_endpoint}?${query.toString()}`, {
        headers: {
          cookie,
          accept: "text/html",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document"
        }
      })
    )
    expect(authorization.status).toBe(302)
    const consentUrl = new URL(authorization.headers.get("location")!, baseUrl)
    expect(consentUrl.pathname).toBe("/oauth/consent")
    expect(consentUrl.searchParams.has("sig")).toBe(true)
    const tampered = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: baseUrl },
      body: JSON.stringify({
        accept: true,
        oauth_query: `${consentUrl.search.slice(1)}&scope=admin`
      })
    })
    expect(tampered.status, await tampered.clone().text()).toBe(400)
    const consent = await fetch(`${baseUrl}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: baseUrl },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentUrl.search.slice(1)
      })
    })
    expect(consent.status).toBe(200)
    const callback = new URL(
      Schema.decodeUnknownSync(Redirect)(await consent.json()).url
    )
    expect(callback.searchParams.get("state")).toBe("roundtrip-state")
    const code = callback.searchParams.get("code")
    expect(code).toBeTruthy()
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code: code!,
      redirect_uri: "http://127.0.0.1:15998/callback",
      code_verifier: verifier,
      resource
    })
    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: "POST",
      body: tokenBody
    })
    expect(tokenResponse.status, await tokenResponse.clone().text()).toBe(200)
    const token = Schema.decodeUnknownSync(Token)(await tokenResponse.json())
    const protectedHandler = requireMcpAuth(
      auth,
      async (_request, claims) => {
        expect(claims.pp_consent_ids).not.toContain(unrelatedClientId)
        expect(claims.pp_consent_ids).toHaveLength(1)
        return Response.json({ userId: claims.sub })
      },
      { resource }
    )
    const protectedResponse = await protectedHandler(
      new Request(resource, {
        headers: { authorization: `Bearer ${token.access_token}` }
      })
    )
    expect(protectedResponse.status).toBe(200)
    expect(await protectedResponse.json()).toEqual({ userId })
    const wrongResource = requireMcpAuth(
      auth,
      async () => new Response("wrong resource"),
      { resource: `${baseUrl}/another-resource` }
    )
    expect(
      (
        await wrongResource(
          new Request(resource, {
            headers: { authorization: `Bearer ${token.access_token}` }
          })
        )
      ).status
    ).toBe(401)
    const initialize = () =>
      handleMcp(
        new Request(resource, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token.access_token}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream"
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-03-26",
              capabilities: {},
              clientInfo: { name: "test", version: "1" }
            }
          })
        })
      )
    expect((await initialize()).status).toBe(200)
    await pool.query(
      "UPDATE oauth_provider_consent SET id=$1 WHERE user_id=$2 AND client_id=$3",
      [randomUUID(), userId, clientId]
    )
    const revoked = await initialize()
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource/mcp"`
    )
    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: token.refresh_token,
      resource
    })
    const refreshed = await fetch(metadata.token_endpoint, {
      method: "POST",
      body: refreshBody
    })
    expect(refreshed.status, await refreshed.clone().text()).toBe(200)
    const rotated = Schema.decodeUnknownSync(Token)(await refreshed.json())
    expect(rotated.refresh_token).not.toBe(token.refresh_token)
    const refreshReplay = await fetch(metadata.token_endpoint, {
      method: "POST",
      body: refreshBody
    })
    expect(refreshReplay.status).toBe(400)
    const replay = await fetch(metadata.token_endpoint, {
      method: "POST",
      body: tokenBody
    })
    expect(replay.status).toBe(400)
  })
})

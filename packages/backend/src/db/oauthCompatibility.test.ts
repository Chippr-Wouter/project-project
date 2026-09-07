import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test"
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer, type Server } from "node:http"
import { createHash, randomUUID } from "node:crypto"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
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
    await disposeMcp()
    if (projectsDir)
      await Effect.runPromise(
        filesystem.remove(projectsDir, { recursive: true, force: true })
      )
    if (pool) {
      if (clientId)
        await pool.query("DELETE FROM oauth_client WHERE client_id=$1", [
          clientId
        ])
      await pool.query('DELETE FROM "user" WHERE id=$1', [userId])
      await pool.end()
    }
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    vi.unstubAllEnvs()
  })

  it("discovers, registers, requires consent, exchanges PKCE codes and verifies resource-bound tokens", async () => {
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
    expect(tampered.status).toBeGreaterThanOrEqual(400)
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
      async (_request, claims) => Response.json({ userId: claims.sub }),
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
    expect((await initialize()).status).toBe(401)
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

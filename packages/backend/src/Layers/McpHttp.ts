import { and, eq, inArray } from "drizzle-orm"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { requireMcpAuth } from "@better-auth/mcp"
import { randomUUID } from "node:crypto"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { auth, mcpResource } from "../auth"
import { oauthConsent } from "../db/auth-schema"
import { Db } from "../Services/Db"
import { currentUserStorage } from "../mcp/currentUserStorage"
import { McpHttp } from "../Services/McpHttp"
import { McpServer } from "../Services/McpServer"
import { Users } from "../Services/Users"

export const McpHttpLive = Layer.scoped(
  McpHttp,
  Effect.gen(function* () {
    const { createServer, runtime } = yield* McpServer
    const db = yield* Db

    type Session = {
      readonly transport: WebStandardStreamableHTTPServerTransport
      readonly server: ReturnType<typeof createServer>
      readonly userId: string
      readonly clientId: string
    }
    const sessions = new Map<string, Session>()
    yield* Effect.addFinalizer(() =>
      Effect.promise(async () => {
        for (const { transport, server } of sessions.values()) {
          await transport.close().catch(() => {})
          await server.close().catch(() => {})
        }
        sessions.clear()
      })
    )

    const unauthorized = () =>
      new Response("Unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", mcpResource).href}"`
        }
      })

    const resolveTransport = async (
      req: Request,
      body: unknown,
      userId: string,
      clientId: string
    ): Promise<WebStandardStreamableHTTPServerTransport | Response> => {
      const sessionId = req.headers.get("mcp-session-id") ?? undefined

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!
        if (session.userId !== userId || session.clientId !== clientId) {
          return unauthorized()
        }
        return session.transport
      }

      if (!sessionId && isInitializeRequest(body)) {
        const server = createServer()
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server, userId, clientId })
          },
          onsessionclosed: (sid) => {
            const existing = sessions.get(sid)
            sessions.delete(sid)
            if (existing) {
              existing.server.close().catch(() => {})
            }
          }
        })
        await server.connect(transport)
        return transport
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: sessionId
              ? "Unknown or expired Mcp-Session-Id"
              : "Mcp-Session-Id header required for non-initialize requests"
          },
          id: null
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    }

    const handle = requireMcpAuth(
      auth,
      async (req, claims) => {
        const userId = claims.sub
        const clientId =
          typeof claims.client_id === "string" ? claims.client_id : undefined
        const consentIds = claims.pp_consent_ids
        if (
          !userId ||
          !clientId ||
          !Schema.is(Schema.Array(Schema.String))(consentIds) ||
          consentIds.length === 0
        ) {
          return unauthorized()
        }

        const exit = await runtime.runPromiseExit(
          Effect.gen(function* () {
            const consents = yield* db
              .select({ id: oauthConsent.id })
              .from(oauthConsent)
              .where(
                and(
                  eq(oauthConsent.userId, userId),
                  eq(oauthConsent.clientId, clientId),
                  inArray(oauthConsent.id, consentIds)
                )
              )
              .limit(1)
              .pipe(Effect.orDie)
            if (consents.length === 0) return null
            const users = yield* Effect.flatMap(Users, (service) =>
              service.fullByIds([userId])
            )
            return users[0] ?? null
          })
        )
        if (Exit.isFailure(exit)) {
          runtime.runSync(
            Effect.logError(
              `mcp authorization lookup failed: ${Cause.pretty(exit.cause)}`
            )
          )
          return new Response("Internal error", { status: 500 })
        }
        const user = exit.value
        if (!user) return unauthorized()

        let body: unknown
        if (req.method === "POST") {
          try {
            body = await req.clone().json()
          } catch {
            body = undefined
          }
        }

        const resolved = await resolveTransport(req, body, userId, clientId)
        if (resolved instanceof Response) return resolved

        try {
          return await currentUserStorage.run(user, () =>
            resolved.handleRequest(req, { parsedBody: body })
          )
        } catch (e) {
          runtime.runSync(
            Effect.logError(
              `mcp transport handleRequest threw: ${
                e instanceof Error ? e.message : String(e)
              }`
            )
          )
          return new Response("Internal MCP transport error", { status: 500 })
        }
      },
      { resource: mcpResource }
    )

    return { handle }
  })
)

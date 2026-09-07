// HTTP-side glue for /mcp. The MCP SDK's web-standard transport accepts a
// Request and returns a Response, which slots cleanly into Bun's HTTP path.
// Auth comes from Better Auth's MCP plugin via withMcpAuth; the resolved
// userId is fanned out into:
//   - the `Users` service (to fetch the full User record), and
//   - the AsyncLocalStorage that the MCP dispatcher reads inside tool
//     callbacks to populate CurrentUser.
//
// SESSION LIFECYCLE
// =================
// The SDK's WebStandardStreamableHTTPServerTransport refuses to be reused
// across requests in stateless mode. The stateful pattern is:
//   1. On `initialize` (no session header) — create a fresh transport,
//      generate an Mcp-Session-Id, register it in a map.
//   2. On non-initialize requests — look up the transport by session id.
//      If unknown, 400.
//   3. On client DELETE — close and forget the transport.
// Each session owns its own SDK server and transport — the SDK's Protocol
// refuses a second `connect()`, so we can't share a single server across
// sessions. The backend runtime (DB, auth, ...) is shared.

import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { withMcpAuth } from "better-auth/plugins"
import { randomUUID } from "node:crypto"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { auth } from "../auth"
import { currentUserStorage } from "../mcp/currentUserStorage"
import { McpHttp } from "../Services/McpHttp"
import { McpServer } from "../Services/McpServer"
import { Users } from "../Services/Users"

export const McpHttpLive = Layer.scoped(
  McpHttp,
  Effect.gen(function* () {
    const { createServer, runtime } = yield* McpServer

    type Session = {
      readonly transport: WebStandardStreamableHTTPServerTransport
      readonly server: ReturnType<typeof createServer>
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

    const resolveTransport = async (
      req: Request,
      body: unknown
    ): Promise<WebStandardStreamableHTTPServerTransport | Response> => {
      const sessionId = req.headers.get("mcp-session-id") ?? undefined

      if (sessionId && sessions.has(sessionId)) {
        return sessions.get(sessionId)!.transport
      }

      if (!sessionId && isInitializeRequest(body)) {
        const server = createServer()
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { transport, server })
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

    const handle = withMcpAuth(auth, async (req, session) => {
      const exit = await runtime.runPromiseExit(
        Effect.flatMap(Users, (u) => u.fullByIds([session.userId]))
      )
      if (Exit.isFailure(exit)) {
        runtime.runSync(
          Effect.logError(`mcp user lookup failed: ${Cause.pretty(exit.cause)}`)
        )
        return new Response("Internal error", { status: 500 })
      }
      const user = exit.value[0]
      if (!user) return new Response("Unauthorized", { status: 401 })

      // Pre-parse the body once; we need it both to decide whether this is
      // an initialize request AND to hand the already-parsed body to the
      // transport (so it doesn't try to re-read a consumed stream).
      let body: unknown
      if (req.method === "POST") {
        try {
          body = await req.clone().json()
        } catch {
          body = undefined
        }
      }

      const resolved = await resolveTransport(req, body)
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
    })

    return { handle }
  })
)

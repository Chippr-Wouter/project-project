import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { withMcpAuth } from "better-auth/plugins"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import { auth } from "../auth"
import { currentUserStorage } from "../mcp/currentUserStorage"
import { McpHttp } from "../Services/McpHttp"
import { McpServer } from "../Services/McpServer"
import { Users } from "../Services/Users"

export const McpHttpLive = Layer.effect(
  McpHttp,
  Effect.gen(function* () {
    const { createServer, runtime } = yield* McpServer

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

      if (req.method !== "POST") {
        return new Response(null, { status: 405, headers: { allow: "POST" } })
      }
      const server = createServer()
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })
      try {
        await server.connect(transport)
        return await currentUserStorage.run(user, () =>
          transport.handleRequest(req)
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
      } finally {
        await server.close()
      }
    })

    return { handle }
  })
)

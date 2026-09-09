import { and, eq, inArray } from "drizzle-orm"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { requireMcpAuth } from "@better-auth/mcp"
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

export const McpHttpLive = Layer.effect(
  McpHttp,
  Effect.gen(function* () {
    const { createServer, runtime } = yield* McpServer
    const db = yield* Db

    const unauthorized = () =>
      new Response("Unauthorized", {
        status: 401,
        headers: {
          "www-authenticate": `Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", mcpResource).href}"`
        }
      })

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
      },
      { resource: mcpResource }
    )

    return { handle }
  })
)

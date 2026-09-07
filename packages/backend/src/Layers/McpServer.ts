// The McpServer Layer builds:
//   1. A ManagedRuntime providing everything handlers need (Users, BetterAuth,
//      Db, ...) EXCEPT CurrentUser — that is provided per-call by the
//      dispatcher because each MCP tool invocation has its own authed user.
//   2. An SDK McpServer with every catalog tool registered.
//
// Lifetime: the runtime is acquired in a scope and disposed when the layer's
// scope ends, so a graceful server shutdown tears everything down. Defects
// from `dispose()` are caught and logged rather than turning into unhandled
// promise rejections during teardown.

import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { registerAllTools } from "../mcp/dispatch"
import { handlers } from "../mcp/handlers"
import { BackendInfrastructureLive, BackendServicesLive } from "../runtime"
import { McpServer } from "../Services/McpServer"

// `Layer.orDie` collapses the layer-construction error channel (SqlError,
// ConfigError, ...) into defects. The dispatcher requires
// `ManagedRuntime<R, never>`; layer-construction errors are not recoverable
// per-request anyway — if the DB can't be reached at startup we want a hard
// crash, not a per-tool error response.
const McpBackendLive = BackendServicesLive.pipe(
  Layer.provideMerge(BackendInfrastructureLive),
  Layer.orDie
)

export const McpServerLive = Layer.effect(
  McpServer,
  Effect.gen(function* () {
    const runtime = ManagedRuntime.make(McpBackendLive)
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => runtime.dispose().catch(() => {}))
    )

    const createServer = () => {
      const server = new SdkMcpServer(
        { name: "projectproject", version: "0.1.0" },
        {
          capabilities: { tools: {} },
          instructions:
            "Read-only access to the user's orgs, groups, projects, and tickets."
        }
      )
      registerAllTools(server, runtime, handlers)
      return server
    }

    return { createServer, runtime }
  })
)

import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js"
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
            "Access the user's organizations, projects, groups, and tickets. Create and update tickets, comments, and sprints. Upload ticket attachments using prepare_ticket_attachment, then POST the file bytes to its uploadUrl from your file environment. The upload response contains committed attachment metadata; use update_ticket to place the permanent URL in the description."
        }
      )
      registerAllTools(server, runtime, handlers)
      return server
    }

    return { createServer, runtime }
  })
)

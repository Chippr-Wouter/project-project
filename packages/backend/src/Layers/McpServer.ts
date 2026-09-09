import { Server as SdkMcpServer } from "@modelcontextprotocol/sdk/server/index.js"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import { registerAllTools } from "../mcp/dispatch"
import { handlers } from "../mcp/handlers"
import * as McpServer from "../Services/McpServer"

export const McpServerLive = Layer.effect(
  McpServer.McpServer,
  Effect.gen(function* () {
    const context = yield* Effect.context<McpServer.McpToolServices>()
    const runtime = ManagedRuntime.make(Layer.succeedContext(context))
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

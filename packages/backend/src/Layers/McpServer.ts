import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
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
            "Read-only access to the user's orgs, groups, projects, and tickets."
        }
      )
      registerAllTools(server, runtime, handlers)
      return server
    }

    return { createServer, runtime }
  })
)

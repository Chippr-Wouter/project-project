import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Layer from "effect/Layer"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import type { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { BackendInfrastructureLive, BackendServicesLive } from "../runtime"

export type McpToolServices =
  | Layer.Success<typeof BackendInfrastructureLive>
  | Layer.Success<typeof BackendServicesLive>

export type McpToolRuntime = ManagedRuntime.ManagedRuntime<
  McpToolServices,
  never
>

export interface McpServerShape {
  readonly createServer: () => SdkMcpServer
  readonly runtime: McpToolRuntime
}

export class McpServer extends Context.Service<McpServer, McpServerShape>()(
  "@projectproject/backend/Services/McpServer"
) {}

export type ToolEffect<A> = Effect.Effect<A, unknown, never>

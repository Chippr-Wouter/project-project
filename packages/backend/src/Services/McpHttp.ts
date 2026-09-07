import * as Context from "effect/Context"

export interface McpHttpHandler {
  readonly handle: (req: Request) => Promise<Response>
}

export class McpHttp extends Context.Service<McpHttp, McpHttpHandler>()(
  "@projectproject/backend/Services/McpHttp"
) {}

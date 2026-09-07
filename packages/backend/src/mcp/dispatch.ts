import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  type Tool
} from "@modelcontextprotocol/sdk/types.js"
import * as Effect from "effect/Effect"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Record from "effect/Record"
import * as Schema from "effect/Schema"
import {
  CurrentUser,
  McpTools,
  Unauthorized,
  type McpToolName
} from "@projectproject/shared"
import { mapToolError } from "./errorMap"
import { currentUserStorage } from "./currentUserStorage"

const isToolName = Schema.is(Schema.Literals(Record.keys(McpTools)))

const tools = Record.toEntries(McpTools).map(([name, spec]): Tool => {
  const document = Schema.toJsonSchemaDocument(spec.input)
  return {
    name,
    description: spec.description,
    inputSchema: {
      ...document.schema,
      type: "object",
      $defs: document.definitions
    }
  }
})

type SpecOf<K extends McpToolName> = (typeof McpTools)[K]

type InputOf<K extends McpToolName> = Schema.Schema.Type<SpecOf<K>["input"]>
type OutputOf<K extends McpToolName> = Schema.Schema.Type<SpecOf<K>["output"]>

type SpecErrors<K extends McpToolName> = Schema.Schema.Type<
  SpecOf<K>["errors"][number]
>

export type HandlersMap<R> = {
  readonly [K in McpToolName]: (
    input: InputOf<K>
  ) => Effect.Effect<OutputOf<K>, SpecErrors<K>, R | CurrentUser>
}

type JsonContentResult = {
  readonly content: ReadonlyArray<{
    readonly type: "text"
    readonly text: string
  }>
}

const asJsonContent = (value: unknown): JsonContentResult => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
})

export function registerAllTools<R>(
  server: Server,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  handlers: HandlersMap<R>
): void {
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const name = request.params.name
    if (!isToolName(name)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`)
    }
    return callTool(runtime, handlers, name, request.params.arguments ?? {})
  })
}

async function callTool<R, K extends McpToolName>(
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  handlers: HandlersMap<R>,
  name: K,
  input: unknown
) {
  const spec = McpTools[name] as SpecOf<K>
  const handler = handlers[name]

  const user = currentUserStorage.getStore()
  if (!user) {
    return mapToolError(new Unauthorized())
  }

  const decoded = Schema.decodeUnknownEffect(spec.input)(
    input
  ) as Effect.Effect<InputOf<K>, Schema.SchemaError>
  const program = decoded.pipe(
    Effect.flatMap(handler),
    Effect.flatMap(Schema.encodeEffect(spec.output)),
    Effect.map(asJsonContent),
    Effect.catch((e) => Effect.succeed(mapToolError(e))),
    Effect.tapDefect((cause) =>
      Effect.logError(`mcp tool defect: ${name}`, cause)
    ),
    Effect.catchDefect((e) => Effect.succeed(mapToolError(e))),
    Effect.provideService(CurrentUser, user),
    Effect.withSpan(`mcp.tool.${name}`)
  )

  return await runtime.runPromise(program)
}

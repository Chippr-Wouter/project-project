// Generic adapter: walks the shared `McpTools` catalog and registers each
// entry on the SDK's `McpServer`. Each tool's input/output schemas come from
// the catalog (Effect Schema). The SDK requires a Zod input schema for tool
// advertisement, which we derive from the catalog at registration time (see
// inputSchemas.ts).
//
// CurrentUser plumbing
// --------------------
// The MCP SDK's tool callback runs outside any Effect scope, so we read the
// authed user from AsyncLocalStorage (populated by /mcp/route.ts wrapping
// transport.handleRequest in storage.run(user, ...)) and provide it onto the
// per-call program via `Effect.provideService(CurrentUser, user)`. This keeps
// the bridging explicit at one boundary instead of hiding it inside a magic
// `Layer.effect(... Effect.suspend(als read))` layer.
//
// Type contracts
// --------------
// `HandlersMap<R>` is derived directly from the shared `McpTools` catalog,
// so each handler's input, output, and error channel are checked against the
// spec at compile time. If a tool's catalog entry drifts from its handler
// (or vice versa) the build fails — there's no `any` shaped escape hatch
// between catalog declaration and runtime dispatch.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import * as Effect from "effect/Effect"
import type * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import {
  CurrentUser,
  McpTools,
  Unauthorized,
  type McpToolName
} from "@projectproject/shared"
import { mapToolError, type McpToolErrorResult } from "./errorMap"
import { currentUserStorage } from "./currentUserStorage"
import { effectToZodObject } from "./inputSchemas"

type SpecOf<K extends McpToolName> = (typeof McpTools)[K]

type InputOf<K extends McpToolName> = Schema.Schema.Type<SpecOf<K>["input"]>
type OutputOf<K extends McpToolName> = Schema.Schema.Type<SpecOf<K>["output"]>

// Union of Schema-decoded error types declared in `spec.errors`. Drives the
// handler's E channel so a handler raising an error not in the catalog
// fails to typecheck.
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
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  handlers: HandlersMap<R>
): void {
  for (const name of Object.keys(McpTools) as Array<McpToolName>) {
    registerOne(server, runtime, handlers, name)
  }
}

function registerOne<R, K extends McpToolName>(
  server: McpServer,
  runtime: ManagedRuntime.ManagedRuntime<R, never>,
  handlers: HandlersMap<R>,
  name: K
): void {
  const spec = McpTools[name] as SpecOf<K>
  const handler = handlers[name] as (
    input: InputOf<K>
  ) => Effect.Effect<OutputOf<K>, SpecErrors<K>, R | CurrentUser>

  const inputZod = effectToZodObject(
    spec.input as unknown as Schema.Schema<unknown, unknown, never>
  )

  server.registerTool(
    name,
    {
      description: spec.description,
      inputSchema: inputZod.shape
    },
    (async (input: unknown) => {
      const user = currentUserStorage.getStore()
      if (!user) {
        return mapToolError(new Unauthorized())
      }

      const decodeInput = Schema.decodeUnknown(
        spec.input as unknown as Schema.Schema<InputOf<K>, unknown, never>
      )
      const encodeOutput = Schema.encode(
        spec.output as unknown as Schema.Schema<OutputOf<K>, unknown, never>
      )

      const program: Effect.Effect<
        JsonContentResult | McpToolErrorResult,
        never,
        R
      > = decodeInput(input).pipe(
        Effect.flatMap(handler),
        Effect.flatMap(encodeOutput),
        Effect.map(asJsonContent),
        Effect.catchAll((e) => Effect.succeed(mapToolError(e))),
        Effect.tapDefect((cause) =>
          Effect.logError(`mcp tool defect: ${name}`, cause)
        ),
        Effect.catchAllDefect((e) => Effect.succeed(mapToolError(e))),
        Effect.provideService(CurrentUser, user),
        Effect.withSpan(`mcp.tool.${name}`)
      )

      return await runtime.runPromise(program)
    }) as Parameters<typeof server.registerTool>[2]
  )
}

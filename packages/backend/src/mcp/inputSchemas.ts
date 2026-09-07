import * as Schema from "effect/Schema"
import { z } from "zod"

type JsonSchemaNode = {
  readonly $ref?: string
  readonly type?: string
  readonly properties?: Record<string, JsonSchemaNode>
  readonly required?: ReadonlyArray<string>
  readonly items?: JsonSchemaNode
  readonly enum?: ReadonlyArray<string | number | boolean | null>
  readonly anyOf?: ReadonlyArray<JsonSchemaNode>
  readonly oneOf?: ReadonlyArray<JsonSchemaNode>
  readonly pattern?: string
  readonly minLength?: number
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly $defs?: Record<string, JsonSchemaNode>
  readonly description?: string
}

const toZod = (
  node: JsonSchemaNode,
  defs: Record<string, JsonSchemaNode>,
  seen: ReadonlySet<string> = new Set()
): z.ZodType => {
  if (node.$ref) {
    const name = node.$ref.replace(/^#\/\$defs\//, "")
    if (seen.has(name)) return z.unknown()
    const target = defs[name]
    if (!target) return z.unknown()
    return toZod(
      { ...target, ...node, $ref: undefined },
      defs,
      new Set([...seen, name])
    )
  }

  if (node.anyOf || node.oneOf) {
    const branches = node.anyOf ?? node.oneOf!
    const variants = branches.map((v) => toZod(v, defs, seen))
    if (variants.length === 2) {
      const nullIdx = branches.findIndex((v) => v.type === "null")
      if (nullIdx === 0) return variants[1]!.nullable()
      if (nullIdx === 1) return variants[0]!.nullable()
    }
    return z.union(variants as [z.ZodType, z.ZodType, ...Array<z.ZodType>])
  }

  if (node.enum) {
    if (node.enum.every((v) => typeof v === "string")) {
      return z.enum(node.enum as Array<string>)
    }
    const variants = node.enum.map((v) =>
      z.literal(v as z.core.util.Literal)
    ) as Array<z.ZodType>
    return z.union(
      variants as unknown as [z.ZodType, z.ZodType, ...Array<z.ZodType>]
    )
  }

  switch (node.type) {
    case "string": {
      let s = z.string()
      if (node.minLength !== undefined) s = s.min(node.minLength)
      if (node.maxLength !== undefined) s = s.max(node.maxLength)
      if (node.pattern) s = s.regex(new RegExp(node.pattern))
      return s
    }
    case "integer": {
      let n = z.number().int()
      if (node.minimum !== undefined) n = n.min(node.minimum)
      if (node.maximum !== undefined) n = n.max(node.maximum)
      return n
    }
    case "number": {
      let n = z.number()
      if (node.minimum !== undefined) n = n.min(node.minimum)
      if (node.maximum !== undefined) n = n.max(node.maximum)
      return n
    }
    case "boolean":
      return z.boolean()
    case "null":
      return z.null()
    case "array":
      return z.array(node.items ? toZod(node.items, defs, seen) : z.unknown())
    case "object": {
      const properties = node.properties ?? {}
      const required = new Set(node.required ?? [])
      const shape: Record<string, z.ZodType> = {}
      for (const [key, value] of Object.entries(properties)) {
        const inner = toZod(value, defs, seen)
        shape[key] = required.has(key) ? inner : inner.optional()
      }
      return z.object(shape)
    }
    default:
      return z.unknown()
  }
}

export const effectToZodObject = <A>(schema: Schema.Schema<A>): z.ZodObject => {
  const document = Schema.toJsonSchemaDocument(schema)
  const root = {
    ...document.schema,
    $defs: document.definitions
  } as JsonSchemaNode
  const defs = root.$defs ?? {}
  const converted = toZod({ ...root, $defs: undefined }, defs, new Set())
  if (converted instanceof z.ZodObject) return converted
  const objectBranch = root.anyOf?.find((b) => b.type === "object")
  if (objectBranch) {
    const fromBranch = toZod(objectBranch, defs, new Set())
    if (fromBranch instanceof z.ZodObject) return fromBranch
  }
  throw new Error(
    `MCP input schema must resolve to a ZodObject (got ${root.type ?? "unknown"})`
  )
}

import * as Schema from "effect/Schema"

// Shared pagination primitives for MCP tool outputs.
//
// `Pagination` is the input shape (optional cursor + optional bounded limit).
// `Page` wraps any item schema in `{ items, nextCursor }`. Cursors are opaque
// base64url-encoded JSON payloads — handlers decode them to read keyset state.

export const Pagination = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(
    Schema.Int.pipe(
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 }))
    )
  )
})
export type Pagination = typeof Pagination.Type

export const Page = <S extends Schema.Top>(item: S) =>
  Schema.Struct({
    items: Schema.Array(item),
    nextCursor: Schema.NullOr(Schema.String)
  })

export interface CursorPayload {
  readonly id: string
  readonly sort: string
}

// base64url via the Web APIs so this module compiles for the browser too.
// Cursor payloads are ASCII-only (ids + ISO dates) in practice, so the
// String.fromCharCode dance over the UTF-8 bytes is sufficient.
const toBase64Url = (bytes: Uint8Array): string => {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const fromBase64Url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const encodeCursor = (p: CursorPayload): string =>
  toBase64Url(new TextEncoder().encode(JSON.stringify(p)))

export const decodeCursor = (s: string): CursorPayload => {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(s)))
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { id?: unknown }).id !== "string" ||
    typeof (parsed as { sort?: unknown }).sort !== "string"
  ) {
    throw new Error("Invalid cursor payload")
  }
  return parsed as CursorPayload
}

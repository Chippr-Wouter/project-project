import * as Context from "effect/Context"
import * as Data from "effect/Data"
import * as Schema from "effect/Schema"
import type * as Effect from "effect/Effect"

export class S3Unavailable extends Data.TaggedError("S3Unavailable")<{
  readonly reason: string
  readonly retryable: boolean
}> {}

export const S3Endpoint = Schema.URLFromString.pipe(
  Schema.check(
    Schema.makeFilter(
      (url) =>
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
)

export interface S3Connection {
  readonly endpoint: string
  readonly bucket: string
  readonly region: string
  readonly keyPrefix: string | null
  readonly forcePathStyle: boolean
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

const MAX_FILENAME_LENGTH = 120

export const sanitizeFilename = (filename: string): string => {
  const collapsed = filename
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/-+\./g, ".")
    .replace(/^[-.]+/, "")
    .replace(/-+$/, "")
  if (collapsed === "" || collapsed === ".") return "file"
  if (collapsed.length <= MAX_FILENAME_LENGTH) return collapsed
  const dot = collapsed.lastIndexOf(".")
  if (dot <= 0) return collapsed.slice(0, MAX_FILENAME_LENGTH)
  const ext = collapsed.slice(dot)
  return `${collapsed.slice(0, MAX_FILENAME_LENGTH - ext.length)}${ext}`
}

export interface AttachmentKeyInput {
  readonly keyPrefix: string | null
  readonly orgSlug: string
  readonly projectSlug: string
  readonly ticketId: string
  readonly attachmentId: string
  readonly filename: string
}

export const attachmentObjectKey = (input: AttachmentKeyInput): string => {
  const prefix = (input.keyPrefix ?? "").replace(/^\/+|\/+$/g, "")
  const tail = `orgs/${input.orgSlug}/projects/${input.projectSlug}/tickets/${input.ticketId}/${input.attachmentId}-${sanitizeFilename(input.filename)}`
  return prefix === "" ? tail : `${prefix}/${tail}`
}

export const normalizeEtag = (etag: string | undefined): string | null => {
  if (!etag) return null
  const trimmed = etag.replace(/^"|"$/g, "").toLowerCase()
  return /^[0-9a-f]{32}$/.test(trimmed) ? trimmed : null
}

export interface S3ObjectHead {
  readonly byteSize: number
  readonly contentType: string | null
  readonly contentHash: string | null
}

export interface S3StorageShape {
  readonly putObject: (
    connection: S3Connection,
    key: string,
    contentType: string,
    bytes: Uint8Array
  ) => Effect.Effect<void, S3Unavailable>
  readonly presignPut: (
    connection: S3Connection,
    key: string,
    contentType: string,
    expiresInSeconds: number
  ) => Effect.Effect<string, S3Unavailable>
  readonly presignGet: (
    connection: S3Connection,
    key: string,
    filename: string,
    inline: boolean,
    expiresInSeconds: number
  ) => Effect.Effect<string, S3Unavailable>
  readonly headObject: (
    connection: S3Connection,
    key: string
  ) => Effect.Effect<S3ObjectHead | null, S3Unavailable>
  readonly deleteObject: (
    connection: S3Connection,
    key: string
  ) => Effect.Effect<void, S3Unavailable>
  readonly checkConnection: (
    connection: S3Connection
  ) => Effect.Effect<void, S3Unavailable>
}

export class S3Storage extends Context.Service<S3Storage, S3StorageShape>()(
  "@projectproject/backend/Services/S3Storage"
) {}

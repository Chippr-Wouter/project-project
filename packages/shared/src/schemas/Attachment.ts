import * as Schema from "effect/Schema"

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

export const ATTACHMENT_PAGE_SIZE = 50

export const isAttachmentDeletable = (row: {
  readonly status: AttachmentStatus
}): boolean => row.status !== "pending"

export const ATTACHMENT_MIN_WIDTH = 96

export const ATTACHMENT_MAX_HEIGHT = 384

export const clampAttachmentWidth = (input: {
  readonly width: number
  readonly naturalWidth: number
  readonly naturalHeight: number
  readonly containerWidth: number
}): number => {
  const ceilingFromContainer = Math.max(
    input.containerWidth,
    ATTACHMENT_MIN_WIDTH
  )
  const aspect =
    input.naturalWidth > 0 && input.naturalHeight > 0
      ? input.naturalWidth / input.naturalHeight
      : null
  const ceilingFromHeight =
    aspect === null ? ceilingFromContainer : ATTACHMENT_MAX_HEIGHT * aspect
  const ceiling = Math.min(ceilingFromContainer, ceilingFromHeight)
  return Math.round(
    Math.min(
      Math.max(input.width, ATTACHMENT_MIN_WIDTH),
      Math.max(ceiling, ATTACHMENT_MIN_WIDTH)
    )
  )
}

export const RASTER_IMAGE_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif"
] as const

export const ATTACHMENT_CONTENT_TYPES = [
  ...RASTER_IMAGE_CONTENT_TYPES,
  "application/pdf",
  "application/zip",
  "application/gzip",
  "application/x-tar"
] as const

export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number]

const normalizeContentType = (value: string) =>
  value.split(";")[0]!.trim().toLowerCase()

export const isAllowedAttachmentContentType = (value: string): boolean =>
  (ATTACHMENT_CONTENT_TYPES as readonly string[]).includes(
    normalizeContentType(value)
  )

export const isRasterImageContentType = (value: string): boolean =>
  (RASTER_IMAGE_CONTENT_TYPES as readonly string[]).includes(
    normalizeContentType(value)
  )

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/

export const AttachmentId = Schema.String.pipe(
  Schema.check(Schema.isPattern(ULID_PATTERN)),
  Schema.brand("AttachmentId")
)
export type AttachmentId = typeof AttachmentId.Type

export const AttachmentStatus = Schema.Literals(["pending", "live", "orphaned"])
export type AttachmentStatus = typeof AttachmentStatus.Type

export const Attachment = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  filename: Schema.String,
  contentType: Schema.String,
  byteSize: Schema.Finite,
  status: AttachmentStatus,
  uploadedBy: Schema.String,
  createdAt: Schema.DateFromString
})
export type Attachment = typeof Attachment.Type

export const PrepareAttachmentInput = Schema.Struct({
  filename: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255))
  ),
  contentType: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  byteSize: Schema.Finite.pipe(Schema.check(Schema.isInt()))
})
export type PrepareAttachmentInput = typeof PrepareAttachmentInput.Type

export const PrepareAttachmentResult = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  uploadUrl: Schema.String,
  expiresAt: Schema.DateFromString
})
export type PrepareAttachmentResult = typeof PrepareAttachmentResult.Type

export const OrgStorageStatus = Schema.Struct({
  status: Schema.Literals(["not_connected", "active", "broken"]),
  endpoint: Schema.NullOr(Schema.String),
  bucket: Schema.NullOr(Schema.String),
  region: Schema.NullOr(Schema.String),
  keyPrefix: Schema.NullOr(Schema.String),
  accessKeyIdMasked: Schema.NullOr(Schema.String),
  forcePathStyle: Schema.Boolean,
  connectedAt: Schema.NullOr(Schema.DateFromString),
  lastCheckedAt: Schema.NullOr(Schema.DateFromString),
  lastCheckError: Schema.NullOr(Schema.String)
})
export type OrgStorageStatus = typeof OrgStorageStatus.Type

export const ConnectStorageInput = Schema.Struct({
  endpoint: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(500))
  ),
  bucket: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255))
  ),
  region: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(64))
  ),
  accessKeyId: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255))
  ),
  secretAccessKey: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  keyPrefix: Schema.NullOr(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(255)))
  ),
  forcePathStyle: Schema.Boolean
})
export type ConnectStorageInput = typeof ConnectStorageInput.Type

export const AttachmentTicketRef = Schema.Struct({
  projectSlug: Schema.String,
  ticketId: Schema.String
})
export type AttachmentTicketRef = typeof AttachmentTicketRef.Type

export const AttachmentRow = Schema.Struct({
  ...Attachment.fields,
  projectSlug: Schema.String,
  ticketId: Schema.String,
  tickets: Schema.Array(AttachmentTicketRef)
})
export type AttachmentRow = typeof AttachmentRow.Type

export const AttachmentSort = Schema.Literals([
  "created_desc",
  "created_asc",
  "size_desc",
  "size_asc"
])
export type AttachmentSort = typeof AttachmentSort.Type

export const AttachmentListParams = Schema.Struct({
  status: Schema.optional(AttachmentStatus),
  projectSlug: Schema.optional(Schema.String),
  sort: Schema.optional(AttachmentSort),
  page: Schema.optional(
    Schema.FiniteFromString.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isGreaterThanOrEqualTo(1))
    )
  ),
  limit: Schema.optional(
    Schema.FiniteFromString.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 200 }))
    )
  )
})
export type AttachmentListParams = typeof AttachmentListParams.Type

export const AttachmentListPage = Schema.Struct({
  items: Schema.Array(AttachmentRow),
  total: Schema.Finite
})
export type AttachmentListPage = typeof AttachmentListPage.Type

export const AttachmentStatusTotals = Schema.Struct({
  status: AttachmentStatus,
  count: Schema.Finite,
  bytes: Schema.Finite
})
export type AttachmentStatusTotals = typeof AttachmentStatusTotals.Type

export const AttachmentSummary = Schema.Struct({
  byStatus: Schema.Array(AttachmentStatusTotals),
  count: Schema.Finite,
  bytes: Schema.Finite
})
export type AttachmentSummary = typeof AttachmentSummary.Type

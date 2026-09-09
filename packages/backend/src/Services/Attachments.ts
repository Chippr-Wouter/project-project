import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_PAGE_SIZE,
  isAllowedAttachmentContentType,
  isRasterImageContentType,
  type Attachment,
  type AttachmentListParams,
  type AttachmentListPage,
  type AttachmentSort,
  type AttachmentSummary,
  type AttachmentNotUploaded,
  type AttachmentTooLarge,
  type AttachmentTypeRejected,
  type Forbidden,
  type NotFound,
  type PrepareAttachmentInput,
  type PrepareAttachmentResult,
  type StorageConfigMissing,
  type StorageError,
  type StorageNotConnected
} from "@projectproject/shared"

export const PENDING_TTL_MS = 60 * 60 * 1000

export const DEFAULT_ATTACHMENT_SORT: AttachmentSort = "created_desc"

export interface AttachmentSortPlan {
  readonly column: "createdAt" | "byteSize"
  readonly direction: "asc" | "desc"
}

export const attachmentSortPlan = (
  sort: AttachmentSort | undefined
): AttachmentSortPlan => {
  switch (sort ?? DEFAULT_ATTACHMENT_SORT) {
    case "created_asc":
      return { column: "createdAt", direction: "asc" }
    case "size_desc":
      return { column: "byteSize", direction: "desc" }
    case "size_asc":
      return { column: "byteSize", direction: "asc" }
    default:
      return { column: "createdAt", direction: "desc" }
  }
}

export const attachmentServesInline = (input: {
  readonly contentType: string
  readonly download: boolean
}): boolean => !input.download && isRasterImageContentType(input.contentType)

export const DEFAULT_ATTACHMENT_LIMIT = ATTACHMENT_PAGE_SIZE

export const attachmentPageOffset = (
  page: number | undefined,
  limit: number
): number => Math.max(0, ((page ?? 1) - 1) * limit)

export interface DedupeRow {
  readonly id: string
  readonly objectKey: string
  readonly contentHash: string | null
  readonly byteSize: number
  readonly createdAt: Date
}

export interface DedupeRepoint {
  readonly id: string
  readonly fromKey: string
  readonly toKey: string
}

export const planDedupe = (input: {
  readonly rows: ReadonlyArray<DedupeRow>
}): ReadonlyArray<DedupeRepoint> => {
  const groups = new Map<string, Array<DedupeRow>>()
  for (const row of input.rows) {
    if (row.contentHash === null) continue
    const key = `${row.contentHash}:${row.byteSize}`
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }

  const repoints: Array<DedupeRepoint> = []
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((left, right) => {
      const byDate = left.createdAt.getTime() - right.createdAt.getTime()
      return byDate === 0 ? left.id.localeCompare(right.id) : byDate
    })
    const canonical = ordered[0]!
    for (const row of ordered.slice(1)) {
      if (row.objectKey === canonical.objectKey) continue
      repoints.push({
        id: row.id,
        fromKey: row.objectKey,
        toKey: canonical.objectKey
      })
    }
  }
  return repoints
}

const STATUS_ORDER = ["live", "orphaned", "pending"] as const

export const summarizeAttachments = (input: {
  readonly rows: ReadonlyArray<{
    readonly objectKey: string
    readonly byteSize: number
    readonly status: "pending" | "live" | "orphaned"
  }>
}): AttachmentSummary => {
  const counts = new Map<string, { count: number; bytes: number }>()
  const charged = new Set<string>()

  const ordered = [...input.rows].sort(
    (left, right) =>
      STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status)
  )

  for (const row of ordered) {
    const entry = counts.get(row.status) ?? { count: 0, bytes: 0 }
    entry.count += 1
    if (!charged.has(row.objectKey)) {
      charged.add(row.objectKey)
      entry.bytes += row.byteSize
    }
    counts.set(row.status, entry)
  }

  const byStatus = STATUS_ORDER.filter((status) => counts.has(status)).map(
    (status) => ({ status, ...counts.get(status)! })
  )

  const stored = byStatus.filter((row) => row.status !== "pending")

  return {
    byStatus,
    count: stored.reduce((total, row) => total + row.count, 0),
    bytes: stored.reduce((total, row) => total + row.bytes, 0)
  }
}

export const isServableStatus = (
  status: "pending" | "live" | "orphaned"
): boolean => status === "live" || status === "orphaned"

export type AttachmentValidationError =
  | { readonly kind: "type"; readonly contentType: string }
  | { readonly kind: "size"; readonly maxBytes: number }

export const validateUploadRequest = (input: {
  readonly contentType: string
  readonly byteSize?: number
}): AttachmentValidationError | null => {
  if (!isAllowedAttachmentContentType(input.contentType)) {
    return { kind: "type", contentType: input.contentType }
  }
  if (
    input.byteSize !== undefined &&
    (input.byteSize <= 0 || input.byteSize > ATTACHMENT_MAX_BYTES)
  ) {
    return { kind: "size", maxBytes: ATTACHMENT_MAX_BYTES }
  }
  return null
}

export type AttachmentUploadError =
  | NotFound
  | Forbidden
  | AttachmentTooLarge
  | AttachmentTypeRejected
  | StorageNotConnected
  | StorageConfigMissing
  | StorageError

export interface AttachmentsShape {
  readonly prepare: (
    orgSlug: string,
    slug: string,
    ticketId: string | null,
    userId: string,
    input: Omit<PrepareAttachmentInput, "byteSize"> & {
      readonly byteSize?: number
    }
  ) => Effect.Effect<PrepareAttachmentResult, AttachmentUploadError>
  readonly commit: (
    orgSlug: string,
    slug: string,
    ticketId: string | null,
    userId: string,
    attachmentId: string
  ) => Effect.Effect<Attachment, AttachmentUploadError | AttachmentNotUploaded>
  readonly resolveForServing: (
    orgSlug: string,
    attachmentId: string,
    userId: string,
    options?: { readonly download?: boolean }
  ) => Effect.Effect<
    { readonly url: string },
    | NotFound
    | Forbidden
    | StorageNotConnected
    | StorageConfigMissing
    | StorageError
  >
  readonly reconcileTicket: (
    orgSlug: string,
    slug: string,
    ticketId: string,
    body: string
  ) => Effect.Effect<void>
  readonly orphanProject: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<{ readonly orphaned: number }>
  readonly listForOrg: (
    orgSlug: string,
    userId: string,
    params: AttachmentListParams
  ) => Effect.Effect<AttachmentListPage, NotFound | Forbidden>
  readonly summarizeForOrg: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<AttachmentSummary, NotFound | Forbidden>
  readonly deleteForOrg: (
    orgSlug: string,
    attachmentId: string,
    userId: string
  ) => Effect.Effect<
    void,
    | NotFound
    | Forbidden
    | StorageNotConnected
    | StorageConfigMissing
    | StorageError
  >
  readonly missingIds: (
    orgSlug: string,
    ids: ReadonlyArray<string>
  ) => Effect.Effect<ReadonlyArray<string>>
  readonly reapOnce: () => Effect.Effect<{ readonly deleted: number }>
  readonly dedupeOnce: () => Effect.Effect<{
    readonly hashed: number
    readonly deduped: number
  }>
}

export class Attachments extends Context.Service<
  Attachments,
  AttachmentsShape
>()("@projectproject/backend/Services/Attachments") {}

export const DEDUPE_HASH_BATCH = 200

export const ORPHAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000
export const REAPER_INTERVAL_MS = 60 * 60 * 1000

export const planReferences = (input: {
  readonly referenced: ReadonlySet<string>
  readonly existing: ReadonlyArray<string>
}): {
  readonly toAdd: ReadonlyArray<string>
  readonly toRemove: ReadonlyArray<string>
} => {
  const existing = new Set(input.existing)
  return {
    toAdd: [...input.referenced].filter((id) => !existing.has(id)),
    toRemove: [...existing].filter((id) => !input.referenced.has(id))
  }
}

export const planStatuses = (input: {
  readonly rows: ReadonlyArray<{
    readonly id: string
    readonly status: "pending" | "live" | "orphaned"
  }>
  readonly referenceCounts: ReadonlyMap<string, number>
}): {
  readonly toLive: ReadonlyArray<string>
  readonly toOrphan: ReadonlyArray<string>
} => {
  const toLive: Array<string> = []
  const toOrphan: Array<string> = []
  for (const row of input.rows) {
    const count = input.referenceCounts.get(row.id) ?? 0
    if (count > 0) {
      if (row.status === "orphaned") toLive.push(row.id)
    } else if (row.status === "live") {
      toOrphan.push(row.id)
    }
  }
  return { toLive, toOrphan }
}

export interface ReapRow {
  readonly id: string
  readonly status: "pending" | "live" | "orphaned"
  readonly createdAt: Date
  readonly orphanedAt: Date | null
}

export const planReap = (input: {
  readonly now: number
  readonly rows: ReadonlyArray<ReapRow>
}): ReadonlyArray<string> =>
  input.rows
    .filter((row) => {
      if (row.status === "pending") {
        return input.now - row.createdAt.getTime() > PENDING_TTL_MS
      }
      if (row.status === "orphaned") {
        if (row.orphanedAt === null) return false
        return input.now - row.orphanedAt.getTime() > ORPHAN_GRACE_MS
      }
      return false
    })
    .map((row) => row.id)

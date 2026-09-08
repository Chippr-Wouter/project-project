import {
  extractFigmaRefs,
  figmaRefKey,
  NotFound,
  StorageError,
  type FigmaLinkMetadata,
  type FigmaRef
} from "@projectproject/shared"
import { and, asc, eq, inArray, isNull } from "drizzle-orm"
import * as Config from "effect/Config"
import * as Data from "effect/Data"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ulid } from "ulid"
import { figmaLinkIndex, figmaReference, projectIndex } from "../db/schema"
import { CurrentOrg, requireOrgAdmin } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import {
  Figma,
  type FigmaCallError,
  type FigmaCredential
} from "../Services/Figma"
import { FigmaIntegrations } from "../Services/FigmaIntegrations"
import {
  devResourceName,
  figmaThumbnailUrl,
  FigmaLinks,
  planFigmaReferences,
  shouldBacklink,
  type FigmaLinksShape
} from "../Services/FigmaLinks"
import { OrgStorage } from "../Services/OrgStorage"
import { Projects } from "../Services/Projects"
import { S3Storage, type S3Connection } from "../Services/S3Storage"

class ThumbnailUploadFailed extends Data.TaggedError("ThumbnailUploadFailed")<{
  readonly reason: string
}> {}

const THUMBNAIL_SCALE = 2

const THUMBNAIL_UPLOAD_TTL_SECONDS = 300

const THUMBNAIL_VIEW_TTL_SECONDS = 3600

const RESOLVE_CONCURRENCY = 2

const METADATA_TTL_MS = 24 * 60 * 60 * 1000

const publicBaseUrl = Config.string("BETTER_AUTH_URL").pipe(
  Config.withDefault("http://localhost:5173")
)

const ticketUrl = (orgSlug: string, slug: string, ticketId: string) =>
  Effect.map(
    publicBaseUrl,
    (base) =>
      new URL(
        `/orgs/${orgSlug}/projects/${slug}/tickets/${ticketId}`,
        base
      ).toString()
  )

export const needsFigmaMetadata = (
  row: {
    readonly fetchedAt: Date | null
    readonly lastCheckStatus: "ok" | "error" | null
  },
  now: Date
): boolean => {
  if (row.fetchedAt === null || row.lastCheckStatus !== "ok") return true
  return now.getTime() - row.fetchedAt.getTime() >= METADATA_TTL_MS
}

export const figmaThumbnailKey = (input: {
  readonly keyPrefix: string | null
  readonly orgSlug: string
  readonly fileKey: string
  readonly nodeId: string | null
}): string => {
  const prefix = (input.keyPrefix ?? "").replace(/^\/+|\/+$/g, "")
  const node =
    input.nodeId === null
      ? "file"
      : input.nodeId.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  const tail = `orgs/${input.orgSlug}/figma/${input.fileKey}/${node === "" ? "file" : node}.png`
  return prefix === "" ? tail : `${prefix}/${tail}`
}

export const figmaCheckReason = (error: FigmaCallError): string => {
  switch (error._tag) {
    case "FigmaAuthInvalid":
      return "figma_auth_invalid"
    case "FigmaRateLimited":
      return "figma_rate_limited"
    case "FigmaFileNotFound":
      return "figma_file_not_found"
    default:
      return "figma_unavailable"
  }
}

export const figmaLinkMetadata = (input: {
  readonly fileKey: string
  readonly nodeId: string | null
  readonly name: string | null
  readonly fileName: string | null
  readonly lastModified: Date | null
  readonly thumbnailUrl: string | null
}): FigmaLinkMetadata => ({
  fileKey: input.fileKey,
  nodeId: input.nodeId,
  name: input.name ?? input.fileName ?? input.fileKey,
  fileName: input.fileName ?? input.fileKey,
  thumbnailUrl: input.thumbnailUrl,
  lastModified:
    input.lastModified === null
      ? null
      : DateTime.unsafeFromDate(input.lastModified)
})

export const FigmaLinksLive = Layer.effect(
  FigmaLinks,
  Effect.gen(function* () {
    const currentOrg = yield* CurrentOrg
    const db = yield* Db
    const figma = yield* Figma
    const integrations = yield* FigmaIntegrations
    const orgStorage = yield* OrgStorage
    const projects = yield* Projects
    const s3 = yield* S3Storage

    const uploadThumbnail = (
      connection: S3Connection,
      key: string,
      bytes: Uint8Array
    ) =>
      Effect.gen(function* () {
        const url = yield* s3.presignPut(
          connection,
          key,
          "image/png",
          THUMBNAIL_UPLOAD_TTL_SECONDS
        )
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              method: "PUT",
              headers: { "Content-Type": "image/png" },
              body: bytes
            }),
          catch: () =>
            new ThumbnailUploadFailed({ reason: "thumbnail_upload_failed" })
        })
        if (!response.ok) {
          return yield* new ThumbnailUploadFailed({
            reason: "thumbnail_upload_rejected"
          })
        }
        return key
      })

    const resolveThumbnail = (
      credential: FigmaCredential,
      orgSlug: string,
      ref: FigmaRef
    ) =>
      Effect.gen(function* () {
        const connection = yield* orgStorage.requireConnection(orgSlug)
        const bytes = yield* figma.renderNode(
          credential,
          ref.fileKey,
          ref.nodeId,
          THUMBNAIL_SCALE
        )
        const key = figmaThumbnailKey({
          keyPrefix: connection.keyPrefix,
          orgSlug,
          fileKey: ref.fileKey,
          nodeId: ref.nodeId
        })
        return yield* uploadThumbnail(connection, key, bytes)
      }).pipe(
        Effect.catchAllCause((cause) =>
          Effect.logDebug("figma thumbnail skipped").pipe(
            Effect.annotateLogs({
              orgSlug,
              fileKey: ref.fileKey,
              cause: String(cause)
            }),
            Effect.as(null)
          )
        )
      )

    const recordError = (linkId: string, reason: string) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        yield* db
          .update(figmaLinkIndex)
          .set({
            lastCheckStatus: "error",
            lastCheckError: reason,
            fetchedAt: now
          })
          .where(eq(figmaLinkIndex.id, linkId))
      })

    const resolveOne = (
      orgSlug: string,
      slug: string,
      entry: { readonly linkId: string; readonly ref: FigmaRef }
    ) =>
      Effect.gen(function* () {
        const credential = yield* integrations.credentialFor(
          orgSlug,
          slug,
          null
        )
        const file = yield* figma.getFile(credential, entry.ref.fileKey)
        const nodeName =
          entry.ref.nodeId === null
            ? null
            : yield* figma
                .getNodeName(credential, entry.ref.fileKey, entry.ref.nodeId)
                .pipe(Effect.map((node) => node.name))
        const thumbnailKey = yield* resolveThumbnail(
          credential,
          orgSlug,
          entry.ref
        )
        const now = yield* DateTime.nowAsDate
        yield* db
          .update(figmaLinkIndex)
          .set({
            name: nodeName,
            fileName: file.name,
            lastModified: file.lastModified,
            fetchedAt: now,
            lastCheckStatus: "ok",
            lastCheckError: null,
            ...(thumbnailKey === null ? {} : { thumbnailKey })
          })
          .where(eq(figmaLinkIndex.id, entry.linkId))
      }).pipe(
        Effect.catchTag("FigmaNotConnected", () =>
          Effect.logDebug("figma metadata skipped: project not connected").pipe(
            Effect.annotateLogs({ orgSlug, projectSlug: slug }),
            Effect.zipRight(recordError(entry.linkId, "figma_not_connected"))
          )
        ),
        Effect.catchTags({
          FigmaAuthInvalid: (error) =>
            recordError(entry.linkId, figmaCheckReason(error)),
          FigmaRateLimited: (error) =>
            recordError(entry.linkId, figmaCheckReason(error)),
          FigmaFileNotFound: (error) =>
            recordError(entry.linkId, figmaCheckReason(error)),
          FigmaError: (error) =>
            recordError(entry.linkId, figmaCheckReason(error))
        }),
        Effect.catchAllCause((cause) =>
          Effect.logWarning("figma metadata resolution failed").pipe(
            Effect.annotateLogs({
              orgSlug,
              projectSlug: slug,
              fileKey: entry.ref.fileKey,
              cause: String(cause)
            })
          )
        )
      )

    const resolveLinks = (
      orgSlug: string,
      slug: string,
      entries: ReadonlyArray<{
        readonly linkId: string
        readonly ref: FigmaRef
      }>
    ) =>
      Effect.forEach(entries, (entry) => resolveOne(orgSlug, slug, entry), {
        concurrency: RESOLVE_CONCURRENCY,
        discard: true
      })

    const createBacklinks = (
      orgSlug: string,
      slug: string,
      ticketId: string,
      title: string,
      entries: ReadonlyArray<{
        readonly linkId: string
        readonly ref: FigmaRef
      }>
    ) =>
      Effect.gen(function* () {
        if (entries.length === 0) return

        const credential = yield* integrations.credentialFor(
          orgSlug,
          slug,
          null
        )
        const url = yield* ticketUrl(orgSlug, slug, ticketId)
        const name = devResourceName(ticketId, title)

        yield* Effect.forEach(
          entries,
          (entry) =>
            Effect.gen(function* () {
              if (entry.ref.nodeId === null) return
              const devResourceId = yield* figma.createDevResource(
                credential,
                {
                  fileKey: entry.ref.fileKey,
                  nodeId: entry.ref.nodeId,
                  name,
                  url
                }
              )
              if (devResourceId === null) return
              yield* db
                .update(figmaReference)
                .set({ devResourceId })
                .where(
                  and(
                    eq(figmaReference.linkId, entry.linkId),
                    eq(figmaReference.orgSlug, orgSlug),
                    eq(figmaReference.projectSlug, slug),
                    eq(figmaReference.ticketId, ticketId)
                  )
                )
            }),
          { concurrency: RESOLVE_CONCURRENCY, discard: true }
        )
      }).pipe(
        Effect.catchTag("FigmaNotConnected", () =>
          Effect.logDebug(
            "figma backlink skipped: project not connected"
          ).pipe(Effect.annotateLogs({ orgSlug, projectSlug: slug, ticketId }))
        ),
        Effect.catchAllCause((cause) =>
          Effect.logWarning("figma backlink failed").pipe(
            Effect.annotateLogs({
              orgSlug,
              projectSlug: slug,
              ticketId,
              cause: String(cause)
            })
          )
        )
      )

    const retractBacklinks = (
      orgSlug: string,
      slug: string,
      ticketId: string,
      entries: ReadonlyArray<{
        readonly linkId: string
        readonly fileKey: string
        readonly devResourceId: string
      }>
    ) =>
      Effect.gen(function* () {
        if (entries.length === 0) return
        const credential = yield* integrations.credentialFor(
          orgSlug,
          slug,
          null
        )
        yield* Effect.forEach(
          entries,
          (entry) =>
            Effect.gen(function* () {
              yield* figma.deleteDevResource(
                credential,
                entry.fileKey,
                entry.devResourceId
              )
              yield* db
                .delete(figmaReference)
                .where(
                  and(
                    eq(figmaReference.linkId, entry.linkId),
                    eq(figmaReference.orgSlug, orgSlug),
                    eq(figmaReference.projectSlug, slug),
                    eq(figmaReference.ticketId, ticketId)
                  )
                )
            }).pipe(
              Effect.catchAllCause((cause) =>
                Effect.logWarning(
                  "figma backlink retraction failed; reference retained for retry"
                ).pipe(
                  Effect.annotateLogs({
                    orgSlug,
                    projectSlug: slug,
                    ticketId,
                    fileKey: entry.fileKey,
                    cause: String(cause)
                  })
                )
              )
            ),
          { concurrency: RESOLVE_CONCURRENCY, discard: true }
        )
      }).pipe(
        Effect.catchTag("FigmaNotConnected", () =>
          Effect.logDebug(
            "figma backlink retraction skipped: project not connected"
          ).pipe(Effect.annotateLogs({ orgSlug, projectSlug: slug, ticketId }))
        ),
        Effect.catchAllCause((cause) =>
          Effect.logWarning("figma backlink retraction failed").pipe(
            Effect.annotateLogs({
              orgSlug,
              projectSlug: slug,
              ticketId,
              cause: String(cause)
            })
          )
        )
      )

    const upsertLink = (
      organizationId: string,
      orgSlug: string,
      ref: FigmaRef
    ) =>
      Effect.gen(function* () {
        const found = yield* db
          .select({
            id: figmaLinkIndex.id,
            fetchedAt: figmaLinkIndex.fetchedAt,
            lastCheckStatus: figmaLinkIndex.lastCheckStatus
          })
          .from(figmaLinkIndex)
          .where(
            and(
              eq(figmaLinkIndex.orgSlug, orgSlug),
              eq(figmaLinkIndex.fileKey, ref.fileKey),
              ref.nodeId === null
                ? isNull(figmaLinkIndex.nodeId)
                : eq(figmaLinkIndex.nodeId, ref.nodeId)
            )
          )
          .limit(1)
        const existing = found[0]
        if (existing !== undefined) {
          const now = yield* DateTime.nowAsDate
          return { id: existing.id, resolve: needsFigmaMetadata(existing, now) }
        }

        const inserted = yield* db
          .insert(figmaLinkIndex)
          .values({
            id: ulid(),
            organizationId,
            orgSlug,
            fileKey: ref.fileKey,
            nodeId: ref.nodeId,
            kind: ref.kind
          })
          .onConflictDoUpdate({
            target: [
              figmaLinkIndex.orgSlug,
              figmaLinkIndex.fileKey,
              figmaLinkIndex.nodeId
            ],
            set: { kind: ref.kind }
          })
          .returning({ id: figmaLinkIndex.id })
        const id = inserted[0]?.id
        return id === undefined ? null : { id, resolve: true }
      })

    const reconcile = (
      orgSlug: string,
      slug: string,
      ticketId: string,
      title: string,
      body: string
    ) =>
      Effect.gen(function* () {
        const refs = extractFigmaRefs(body)
        const byKey = new Map(refs.map((ref) => [figmaRefKey(ref), ref]))

        const existingRows = yield* db
          .select({
            linkId: figmaReference.linkId,
            fileKey: figmaLinkIndex.fileKey,
            nodeId: figmaLinkIndex.nodeId,
            fetchedAt: figmaLinkIndex.fetchedAt,
            lastCheckStatus: figmaLinkIndex.lastCheckStatus,
            devResourceId: figmaReference.devResourceId
          })
          .from(figmaReference)
          .innerJoin(
            figmaLinkIndex,
            eq(figmaReference.linkId, figmaLinkIndex.id)
          )
          .where(
            and(
              eq(figmaReference.orgSlug, orgSlug),
              eq(figmaReference.projectSlug, slug),
              eq(figmaReference.ticketId, ticketId)
            )
          )

        const existingByKey = new Map(
          existingRows.map((row) => [`${row.fileKey}/${row.nodeId ?? ""}`, row])
        )

        const plan = planFigmaReferences({
          existing: new Set(existingByKey.keys()),
          referenced: new Set(byKey.keys())
        })

        const removalsToRetract: Array<{
          readonly linkId: string
          readonly fileKey: string
          readonly devResourceId: string
        }> = []
        const removalsToDeleteNow: Array<string> = []
        for (const key of plan.removed) {
          const row = existingByKey.get(key)
          if (row === undefined) continue
          if (row.devResourceId !== null) {
            removalsToRetract.push({
              linkId: row.linkId,
              fileKey: row.fileKey,
              devResourceId: row.devResourceId
            })
          } else {
            removalsToDeleteNow.push(row.linkId)
          }
        }
        if (removalsToDeleteNow.length > 0) {
          yield* db
            .delete(figmaReference)
            .where(
              and(
                eq(figmaReference.orgSlug, orgSlug),
                eq(figmaReference.projectSlug, slug),
                eq(figmaReference.ticketId, ticketId),
                inArray(figmaReference.linkId, removalsToDeleteNow)
              )
            )
        }

        const now = yield* DateTime.nowAsDate
        const toResolve: Array<{
          readonly linkId: string
          readonly ref: FigmaRef
        }> = []
        const toBacklink: Array<{
          readonly linkId: string
          readonly ref: FigmaRef
        }> = []
        for (const [key, ref] of byKey) {
          const row = existingByKey.get(key)
          if (row === undefined) continue
          if (needsFigmaMetadata(row, now)) {
            toResolve.push({ linkId: row.linkId, ref })
          }
          if (shouldBacklink(ref) && row.devResourceId === null) {
            toBacklink.push({ linkId: row.linkId, ref })
          }
        }

        if (plan.added.length > 0) {
          const project = yield* db.query.projectIndex.findFirst({
            columns: { organizationId: true },
            where: eq(projectIndex.slug, slug)
          })
          if (project === undefined) return yield* new NotFound()

          const added: Array<{
            readonly linkId: string
            readonly ref: FigmaRef
          }> = []
          for (const key of plan.added) {
            const ref = byKey.get(key)
            if (ref === undefined) continue
            const link = yield* upsertLink(project.organizationId, orgSlug, ref)
            if (link === null) continue
            added.push({ linkId: link.id, ref })
            if (link.resolve) toResolve.push({ linkId: link.id, ref })
            if (shouldBacklink(ref)) toBacklink.push({ linkId: link.id, ref })
          }

          if (added.length > 0) {
            yield* db
              .insert(figmaReference)
              .values(
                added.map((entry) => ({
                  linkId: entry.linkId,
                  orgSlug,
                  projectSlug: slug,
                  ticketId
                }))
              )
              .onConflictDoNothing()
          }
        }

        if (
          toResolve.length === 0 &&
          toBacklink.length === 0 &&
          removalsToRetract.length === 0
        ) {
          return
        }

        yield* Effect.forkDaemon(
          Effect.gen(function* () {
            if (toResolve.length > 0) {
              yield* resolveLinks(orgSlug, slug, toResolve)
            }
            if (toBacklink.length > 0) {
              yield* createBacklinks(orgSlug, slug, ticketId, title, toBacklink)
            }
            if (removalsToRetract.length > 0) {
              yield* retractBacklinks(orgSlug, slug, ticketId, removalsToRetract)
            }
          })
        )
      })

    const reconcileTicket: FigmaLinksShape["reconcileTicket"] = (
      orgSlug,
      slug,
      ticketId,
      title,
      body
    ) =>
      reconcile(orgSlug, slug, ticketId, title, body).pipe(
        Effect.catchAllCause((cause) =>
          Effect.logWarning("figma reconciliation skipped").pipe(
            Effect.annotateLogs({
              orgSlug,
              projectSlug: slug,
              ticketId,
              cause: String(cause)
            })
          )
        ),
        Effect.asVoid
      )

    const listForTicket: FigmaLinksShape["listForTicket"] = (
      orgSlug,
      userId,
      slug,
      ticketId
    ) =>
      Effect.gen(function* () {
        yield* projects.requireMember(orgSlug, userId, slug)

        const rows = yield* db
          .select({
            linkId: figmaLinkIndex.id,
            fileKey: figmaLinkIndex.fileKey,
            nodeId: figmaLinkIndex.nodeId,
            name: figmaLinkIndex.name,
            fileName: figmaLinkIndex.fileName,
            thumbnailKey: figmaLinkIndex.thumbnailKey,
            lastModified: figmaLinkIndex.lastModified
          })
          .from(figmaReference)
          .innerJoin(
            figmaLinkIndex,
            eq(figmaReference.linkId, figmaLinkIndex.id)
          )
          .where(
            and(
              eq(figmaReference.orgSlug, orgSlug),
              eq(figmaReference.projectSlug, slug),
              eq(figmaReference.ticketId, ticketId)
            )
          )
          .orderBy(asc(figmaReference.createdAt))
          .pipe(Effect.orDie)

        return rows.map((row) =>
          figmaLinkMetadata({
            ...row,
            thumbnailUrl:
              row.thumbnailKey === null
                ? null
                : figmaThumbnailUrl(orgSlug, row.linkId)
          })
        )
      })

    const resolveThumbnailUrl: FigmaLinksShape["resolveThumbnailUrl"] = (
      orgSlug,
      userId,
      linkId
    ) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            thumbnailKey: figmaLinkIndex.thumbnailKey,
            projectSlug: figmaReference.projectSlug
          })
          .from(figmaLinkIndex)
          .innerJoin(
            figmaReference,
            eq(figmaReference.linkId, figmaLinkIndex.id)
          )
          .where(
            and(
              eq(figmaLinkIndex.id, linkId),
              eq(figmaLinkIndex.orgSlug, orgSlug)
            )
          )
          .pipe(Effect.orDie)

        if (rows.length === 0) {
          return yield* new NotFound()
        }

        yield* Effect.firstSuccessOf(
          rows.map((row) =>
            projects.requireMember(orgSlug, userId, row.projectSlug)
          )
        ).pipe(
          Effect.catchTag("NotFound", () =>
            requireOrgAdmin(currentOrg, orgSlug, userId)
          )
        )

        const thumbnailKey = rows[0].thumbnailKey
        if (thumbnailKey === null) {
          return yield* new NotFound()
        }

        const connection = yield* orgStorage.requireConnection(orgSlug)

        return yield* s3
          .presignGet(
            connection,
            thumbnailKey,
            "thumbnail.png",
            true,
            THUMBNAIL_VIEW_TTL_SECONDS
          )
          .pipe(
            Effect.catchTag("S3Unavailable", (error) =>
              Effect.fail(new StorageError({ reason: error.reason }))
            )
          )
      })

    return {
      reconcileTicket,
      listForTicket,
      resolveThumbnailUrl
    } satisfies FigmaLinksShape
  })
)

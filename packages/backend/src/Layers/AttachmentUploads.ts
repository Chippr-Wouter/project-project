import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { and, eq } from "drizzle-orm"
import {
  ATTACHMENT_MAX_BYTES,
  AttachmentId,
  AttachmentTooLarge,
  AttachmentTypeRejected,
  NotFound,
  Slug,
  StorageConfigMissing,
  StorageError,
  TicketId,
  Unauthorized,
  Validation
} from "@projectproject/shared"
import * as AttachmentUploads from "../Services/AttachmentUploads"
import * as Attachments from "../Services/Attachments"
import * as Db from "../Services/Db"
import * as OrgStorage from "../Services/OrgStorage"
import * as Projects from "../Services/Projects"
import * as S3Storage from "../Services/S3Storage"
import * as SecretCrypto from "../Services/SecretCrypto"
import * as TicketDocs from "../Services/TicketDocs"
import { attachmentIndex } from "../db/schema"

const UploadGrant = Schema.fromJsonString(
  Schema.Struct({
    purpose: Schema.Literal("ticket-attachment-upload"),
    orgSlug: Slug,
    projectSlug: Slug,
    ticketId: TicketId,
    attachmentId: AttachmentId,
    userId: Schema.String,
    expiresAt: Schema.Number
  })
)
const SealedGrant = Schema.fromJsonString(
  Schema.Struct({
    ciphertext: Schema.String,
    nonce: Schema.String,
    tag: Schema.String
  })
)

export const AttachmentUploadsLive = Layer.effect(
  AttachmentUploads.AttachmentUploads,
  Effect.gen(function* () {
    const attachments = yield* Attachments.Attachments
    const db = yield* Db.Db
    const sql = yield* SqlClient.SqlClient
    const projects = yield* Projects.Projects
    const docs = yield* TicketDocs.TicketDocs
    const orgStorage = yield* OrgStorage.OrgStorage
    const s3 = yield* S3Storage.S3Storage
    const secrets = yield* SecretCrypto.SecretCrypto

    const requireTicket = Effect.fn("AttachmentUploads.requireTicket")(
      function* (
        ticket: AttachmentUploads.TicketAttachmentUpload,
        userId: string
      ) {
        yield* projects.requireMember(
          ticket.orgSlug,
          userId,
          ticket.projectSlug
        )
        yield* docs
          .read(ticket.orgSlug, ticket.projectSlug, ticket.ticketId)
          .pipe(
            Effect.catchTags({
              MarkdownError: Effect.die,
              MalformedTicketDocument: Effect.die
            })
          )
      }
    )

    const prepare: AttachmentUploads.AttachmentUploads["Service"]["prepare"] =
      Effect.fn("AttachmentUploads.prepare")(function* (ticket, userId, input) {
        yield* requireTicket(ticket, userId)
        const baseUrl = yield* Config.string("BETTER_AUTH_URL").pipe(
          Config.withDefault("http://localhost:5173"),
          Effect.mapError(() => new StorageConfigMissing())
        )
        const url = yield* Effect.try({
          try: () => new URL("/api/attachment-uploads", baseUrl),
          catch: () => new StorageConfigMissing()
        })
        const prepared = yield* attachments.prepare(
          ticket.orgSlug,
          ticket.projectSlug,
          ticket.ticketId,
          userId,
          input
        )
        const attachmentId = yield* Schema.decodeEffect(AttachmentId)(
          prepared.id
        ).pipe(Effect.orDie)
        const payload = yield* Schema.encodeEffect(UploadGrant)({
          purpose: "ticket-attachment-upload",
          ...ticket,
          attachmentId,
          userId,
          expiresAt: prepared.expiresAt.getTime()
        }).pipe(Effect.orDie)
        const grant = yield* secrets
          .seal(payload)
          .pipe(Effect.mapError(() => new StorageConfigMissing()))
        const encoded = yield* Schema.encodeEffect(SealedGrant)(grant).pipe(
          Effect.orDie
        )
        url.searchParams.set(
          "token",
          Buffer.from(encoded).toString("base64url")
        )
        return { ...prepared, uploadUrl: url.toString() }
      })

    const receive: AttachmentUploads.AttachmentUploads["Service"]["receive"] =
      Effect.fn("AttachmentUploads.receive")(
        function* (token, contentType, body) {
          if (token.length === 0 || token.length > 4096)
            return yield* new Unauthorized()
          const sealed = yield* Schema.decodeEffect(SealedGrant)(
            Buffer.from(token, "base64url").toString("utf8")
          ).pipe(Effect.mapError(() => new Unauthorized()))
          const plaintext = yield* secrets
            .open(sealed)
            .pipe(
              Effect.mapError((error) =>
                error.reason === "open_failed"
                  ? new Unauthorized()
                  : new StorageConfigMissing()
              )
            )
          const grant = yield* Schema.decodeEffect(UploadGrant)(plaintext).pipe(
            Effect.mapError(() => new Unauthorized())
          )
          const checkExpiry = Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate
            if (grant.expiresAt <= now.getTime())
              return yield* new Unauthorized()
            return undefined
          })
          yield* checkExpiry
          yield* requireTicket(grant, grant.userId)
          const query = () =>
            db
              .select()
              .from(attachmentIndex)
              .where(
                and(
                  eq(attachmentIndex.id, grant.attachmentId),
                  eq(attachmentIndex.orgSlug, grant.orgSlug),
                  eq(attachmentIndex.projectSlug, grant.projectSlug),
                  eq(attachmentIndex.ticketId, grant.ticketId),
                  eq(attachmentIndex.uploadedBy, grant.userId)
                )
              )
          const [prepared] = yield* query().pipe(Effect.orDie)
          if (!prepared) return yield* new NotFound()
          if (
            contentType.split(";")[0].trim().toLowerCase() !==
            prepared.contentType.split(";")[0].trim().toLowerCase()
          ) {
            return yield* new AttachmentTypeRejected({ contentType })
          }
          const bytes = new Uint8Array(prepared.byteSize)
          let offset = 0
          yield* body.pipe(
            Stream.runForEach((chunk) =>
              Effect.gen(function* () {
                if (offset + chunk.byteLength > bytes.byteLength)
                  return yield* new AttachmentTooLarge({
                    maxBytes: ATTACHMENT_MAX_BYTES
                  })
                bytes.set(chunk, offset)
                offset += chunk.byteLength
                return undefined
              })
            )
          )
          if (offset !== bytes.byteLength)
            return yield* new AttachmentTooLarge({
              maxBytes: ATTACHMENT_MAX_BYTES
            })

          return yield* sql
            .withTransaction(
              Effect.gen(function* () {
                const [row] = yield* query().for("update").pipe(Effect.orDie)
                if (!row || row.status === "orphaned")
                  return yield* new NotFound()
                yield* checkExpiry
                yield* requireTicket(grant, grant.userId)
                if (row.status === "pending") {
                  const connection = yield* orgStorage.requireConnection(
                    grant.orgSlug
                  )
                  yield* s3
                    .putObject(
                      connection,
                      row.objectKey,
                      row.contentType,
                      bytes
                    )
                    .pipe(
                      Effect.mapError(
                        () => new StorageError({ reason: "upload_failed" })
                      )
                    )
                }
                const { id, url, filename, contentType } =
                  yield* attachments.commit(
                    grant.orgSlug,
                    grant.projectSlug,
                    grant.ticketId,
                    grant.userId,
                    grant.attachmentId
                  )
                return { id, url, filename, contentType }
              })
            )
            .pipe(Effect.catchTag("SqlError", Effect.die))
        },
        Effect.timeout("60 seconds"),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new Validation({
              reason:
                "Upload timed out. Retry the upload URL, or prepare a new upload if it expired."
            })
          )
        )
      )

    return { prepare, receive }
  })
)

import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { and, eq, inArray } from "drizzle-orm"
import { ulid } from "ulid"
import {
  NotFound,
  StorageAuthInvalid,
  StorageConfigMissing,
  StorageError,
  StorageNotConnected,
  type OrgStorageStatus
} from "@projectproject/shared"
import {
  organization,
  organizationIntegration,
  organizationS3Integration
} from "../db/schema"
import { CurrentOrg, requireOrgAdmin } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import {
  maskAccessKeyId,
  OrgStorage,
  type OrgStorageShape
} from "../Services/OrgStorage"
import { S3Storage, type S3Connection } from "../Services/S3Storage"
import { SecretCrypto } from "../Services/SecretCrypto"

const notConnectedStatus: OrgStorageStatus = {
  status: "not_connected",
  endpoint: null,
  bucket: null,
  region: null,
  keyPrefix: null,
  accessKeyIdMasked: null,
  forcePathStyle: true,
  connectedAt: null,
  lastCheckedAt: null,
  lastCheckError: null
}

export const OrgStorageLive = Layer.effect(
  OrgStorage,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const currentOrg = yield* CurrentOrg
    const s3 = yield* S3Storage
    const secrets = yield* SecretCrypto

    const activeOrBrokenS3Row = (organizationId: string) =>
      db
        .select({
          endpoint: organizationS3Integration.endpoint,
          bucket: organizationS3Integration.bucket,
          region: organizationS3Integration.region,
          keyPrefix: organizationS3Integration.keyPrefix,
          forcePathStyle: organizationS3Integration.forcePathStyle,
          accessKeyId: organizationS3Integration.accessKeyId,
          status: organizationIntegration.status,
          connectedAt: organizationIntegration.connectedAt,
          lastCheckedAt: organizationIntegration.lastCheckedAt,
          lastCheckError: organizationIntegration.lastCheckError
        })
        .from(organizationIntegration)
        .leftJoin(
          organizationS3Integration,
          eq(
            organizationS3Integration.organizationIntegrationId,
            organizationIntegration.id
          )
        )
        .where(
          and(
            eq(organizationIntegration.organizationId, organizationId),
            eq(organizationIntegration.provider, "s3"),
            inArray(organizationIntegration.status, ["active", "broken"])
          )
        )
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0] ?? null)
        )

    const getStatus = (
      orgSlug: string,
      userId: string
    ): Effect.Effect<OrgStorageStatus, NotFound> =>
      Effect.gen(function* () {
        const org = yield* currentOrg.resolve(orgSlug, userId)
        const row = yield* activeOrBrokenS3Row(org.organizationId)
        if (!row) return notConnectedStatus
        return {
          status: row.status === "active" ? "active" : "broken",
          endpoint: row.endpoint,
          bucket: row.bucket,
          region: row.region,
          keyPrefix: row.keyPrefix,
          accessKeyIdMasked:
            row.accessKeyId == null ? null : maskAccessKeyId(row.accessKeyId),
          forcePathStyle: row.forcePathStyle ?? true,
          connectedAt: row.connectedAt,
          lastCheckedAt: row.lastCheckedAt,
          lastCheckError: row.lastCheckError
        }
      })

    const connectionCheckKey = (keyPrefix: string | null) => {
      const prefix = (keyPrefix ?? "").replace(/^\/+|\/+$/g, "")
      const tail = `.projectproject-connection-check/${ulid()}`
      return prefix === "" ? tail : `${prefix}/${tail}`
    }

    const mapS3Unavailable = (error: { reason: string }) =>
      error.reason === "auth"
        ? new StorageAuthInvalid()
        : new StorageError({ reason: error.reason })

    const roundTripCheck = (connection: S3Connection) =>
      Effect.gen(function* () {
        yield* s3.checkConnection(connection)
        const key = connectionCheckKey(connection.keyPrefix)
        const uploadUrl = yield* s3.presignPut(
          connection,
          key,
          "text/plain",
          60
        )
        const uploadResponse = yield* Effect.tryPromise({
          try: () =>
            fetch(uploadUrl, {
              method: "PUT",
              body: "projectproject-connection-check",
              headers: { "content-type": "text/plain" },
              credentials: "omit"
            }),
          catch: () =>
            new StorageError({ reason: "connection_check_upload_failed" })
        })
        if (!uploadResponse.ok) {
          const status = uploadResponse.status
          return yield* status === 401 || status === 403
            ? new StorageAuthInvalid()
            : new StorageError({
                reason: `connection_check_upload_status_${status}`
              })
        }
        const head = yield* s3.headObject(connection, key)
        yield* s3.deleteObject(connection, key)
        if (!head) {
          return yield* new StorageError({
            reason: "connection_check_missing_object"
          })
        }
      }).pipe(
        Effect.catchTag("S3Unavailable", (error) =>
          Effect.fail(mapS3Unavailable(error))
        )
      )

    const connect = (
      orgSlug: string,
      userId: string,
      input: {
        readonly endpoint: string
        readonly bucket: string
        readonly region: string
        readonly accessKeyId: string
        readonly secretAccessKey: string
        readonly keyPrefix: string | null
        readonly forcePathStyle: boolean
      }
    ) =>
      Effect.gen(function* () {
        const org = yield* requireOrgAdmin(currentOrg, orgSlug, userId)

        const connection: S3Connection = {
          endpoint: input.endpoint,
          bucket: input.bucket,
          region: input.region,
          keyPrefix: input.keyPrefix,
          forcePathStyle: input.forcePathStyle,
          accessKeyId: input.accessKeyId,
          secretAccessKey: input.secretAccessKey
        }

        yield* roundTripCheck(connection)

        const sealed = yield* secrets
          .seal(input.secretAccessKey)
          .pipe(
            Effect.catchTag("SecretCryptoUnavailable", () =>
              Effect.fail(new StorageConfigMissing())
            )
          )

        const now = yield* DateTime.nowAsDate

        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* db
                .update(organizationIntegration)
                .set({
                  status: "disconnected",
                  disconnectedAt: now,
                  updatedAt: now
                })
                .where(
                  and(
                    eq(
                      organizationIntegration.organizationId,
                      org.organizationId
                    ),
                    eq(organizationIntegration.provider, "s3"),
                    inArray(organizationIntegration.status, [
                      "active",
                      "broken"
                    ])
                  )
                )
                .pipe(Effect.orDie)

              const [created] = yield* db
                .insert(organizationIntegration)
                .values({
                  organizationId: org.organizationId,
                  provider: "s3",
                  status: "active",
                  config: {},
                  lastCheckedAt: now,
                  lastCheckStatus: "ok"
                })
                .returning()
                .pipe(Effect.orDie)

              yield* db
                .insert(organizationS3Integration)
                .values({
                  organizationIntegrationId: created.id,
                  endpoint: input.endpoint,
                  bucket: input.bucket,
                  region: input.region,
                  keyPrefix: input.keyPrefix,
                  forcePathStyle: input.forcePathStyle,
                  accessKeyId: input.accessKeyId,
                  encryptedSecretKey: sealed.ciphertext,
                  secretKeyNonce: sealed.nonce,
                  secretKeyTag: sealed.tag
                })
                .pipe(Effect.orDie)
            })
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))

        return yield* getStatus(orgSlug, userId)
      })

    const disconnect = (orgSlug: string, userId: string) =>
      Effect.gen(function* () {
        const org = yield* requireOrgAdmin(currentOrg, orgSlug, userId)
        const now = yield* DateTime.nowAsDate
        yield* db
          .update(organizationIntegration)
          .set({
            status: "disconnected",
            disconnectedAt: now,
            updatedAt: now
          })
          .where(
            and(
              eq(organizationIntegration.organizationId, org.organizationId),
              eq(organizationIntegration.provider, "s3"),
              inArray(organizationIntegration.status, ["active", "broken"])
            )
          )
          .pipe(Effect.orDie)
        return yield* getStatus(orgSlug, userId)
      })

    const requireConnection = (orgSlug: string) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({
            endpoint: organizationS3Integration.endpoint,
            bucket: organizationS3Integration.bucket,
            region: organizationS3Integration.region,
            keyPrefix: organizationS3Integration.keyPrefix,
            forcePathStyle: organizationS3Integration.forcePathStyle,
            accessKeyId: organizationS3Integration.accessKeyId,
            encryptedSecretKey: organizationS3Integration.encryptedSecretKey,
            secretKeyNonce: organizationS3Integration.secretKeyNonce,
            secretKeyTag: organizationS3Integration.secretKeyTag
          })
          .from(organization)
          .innerJoin(
            organizationIntegration,
            eq(organizationIntegration.organizationId, organization.id)
          )
          .innerJoin(
            organizationS3Integration,
            eq(
              organizationS3Integration.organizationIntegrationId,
              organizationIntegration.id
            )
          )
          .where(
            and(
              eq(organization.slug, orgSlug),
              eq(organizationIntegration.provider, "s3"),
              eq(organizationIntegration.status, "active")
            )
          )
          .limit(1)
          .pipe(Effect.orDie)

        const row = rows[0]
        if (!row) return yield* new StorageNotConnected()

        const secretAccessKey = yield* secrets
          .open({
            ciphertext: row.encryptedSecretKey,
            nonce: row.secretKeyNonce,
            tag: row.secretKeyTag
          })
          .pipe(
            Effect.catchTag("SecretCryptoUnavailable", () =>
              Effect.fail(new StorageConfigMissing())
            )
          )

        return {
          endpoint: row.endpoint,
          bucket: row.bucket,
          region: row.region,
          keyPrefix: row.keyPrefix,
          forcePathStyle: row.forcePathStyle,
          accessKeyId: row.accessKeyId,
          secretAccessKey
        } satisfies S3Connection
      })

    return {
      getStatus,
      connect,
      disconnect,
      requireConnection
    } satisfies OrgStorageShape
  })
)

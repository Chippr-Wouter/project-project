import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  normalizeEtag,
  S3Endpoint,
  S3Storage,
  S3Unavailable,
  type S3Connection
} from "../Services/S3Storage"

const clientFor = (connection: S3Connection) =>
  new S3Client({
    region: connection.region,
    endpoint: connection.endpoint,
    forcePathStyle: connection.forcePathStyle,
    credentials: {
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.secretAccessKey
    }
  })

const isAuthFailure = (cause: unknown) => {
  const name = (cause as { name?: string } | null)?.name ?? ""
  const status =
    (cause as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
      ?.httpStatusCode ?? 0
  return (
    status === 401 ||
    status === 403 ||
    name === "InvalidAccessKeyId" ||
    name === "SignatureDoesNotMatch" ||
    name === "AccessDenied"
  )
}

const isNotFound = (cause: unknown) => {
  const name = (cause as { name?: string } | null)?.name ?? ""
  const status =
    (cause as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
      ?.httpStatusCode ?? 0
  return status === 404 || name === "NotFound" || name === "NoSuchKey"
}

const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new S3Unavailable({
        reason: isAuthFailure(cause)
          ? "auth"
          : ((cause as { name?: string } | null)?.name ?? "unknown"),
        retryable: !isAuthFailure(cause)
      })
  })

const withClient = Effect.fn("S3Storage.withClient")(function* <A>(
  connection: S3Connection,
  use: (client: S3Client) => Promise<A>
) {
  yield* Schema.decodeEffect(S3Endpoint)(connection.endpoint).pipe(
    Effect.mapError(
      () =>
        new S3Unavailable({
          reason:
            "Storage endpoint must use HTTPS, or HTTP on localhost for local development.",
          retryable: false
        })
    )
  )
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => clientFor(connection)),
    (client) => attempt(() => use(client)),
    (client) => Effect.sync(() => client.destroy())
  )
})

export const S3StorageLive = Layer.succeed(
  S3Storage,
  S3Storage.of({
    putObject: (connection, key, contentType, bytes) =>
      withClient(connection, async (client) => {
        await client.send(
          new PutObjectCommand({
            Bucket: connection.bucket,
            Key: key,
            ContentType: contentType,
            Body: bytes
          })
        )
      }),
    presignPut: (connection, key, contentType, expiresInSeconds) =>
      withClient(connection, (client) =>
        getSignedUrl(
          client,
          new PutObjectCommand({
            Bucket: connection.bucket,
            Key: key,
            ContentType: contentType
          }),
          { expiresIn: expiresInSeconds }
        )
      ),
    presignGet: (connection, key, filename, inline, expiresInSeconds) =>
      withClient(connection, (client) =>
        getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: connection.bucket,
            Key: key,
            ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "")}"`
          }),
          { expiresIn: expiresInSeconds }
        )
      ),
    headObject: (connection, key) =>
      withClient(connection, async (client) => {
        try {
          const head = await client.send(
            new HeadObjectCommand({ Bucket: connection.bucket, Key: key })
          )
          return {
            byteSize: head.ContentLength ?? 0,
            contentType: head.ContentType ?? null,
            contentHash: normalizeEtag(head.ETag)
          }
        } catch (cause) {
          if (isNotFound(cause)) return null
          throw cause
        }
      }),
    deleteObject: (connection, key) =>
      withClient(connection, async (client) => {
        await client.send(
          new DeleteObjectCommand({ Bucket: connection.bucket, Key: key })
        )
      }),
    checkConnection: (connection) =>
      withClient(connection, async (client) => {
        await client.send(new HeadBucketCommand({ Bucket: connection.bucket }))
      })
  })
)

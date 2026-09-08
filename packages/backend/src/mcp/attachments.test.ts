import { beforeAll, afterAll, describe, expect, vi } from "vite-plus/test"
import { it } from "@effect/vitest"
import { randomUUID, randomBytes } from "node:crypto"
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectCommand
} from "@aws-sdk/client-s3"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { PgClient } from "@effect/sql-pg"
import { eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import {
  CurrentUser,
  McpTools,
  NotFound,
  StorageNotConnected,
  StorageConfigMissing,
  StorageError,
  TicketId,
  TicketStatus,
  User
} from "@projectproject/shared"
import * as AttachmentsLayer from "../Layers/Attachments"
import * as AttachmentUploadsLayer from "../Layers/AttachmentUploads"
import * as AttachmentUploads from "../Services/AttachmentUploads"
import * as S3StorageLayer from "../Layers/S3Storage"
import * as SecretCryptoLayer from "../Layers/SecretCrypto"
import * as Db from "../Services/Db"
import * as DbLayer from "../Layers/Db"
import * as OrgStorage from "../Services/OrgStorage"
import * as S3Storage from "../Services/S3Storage"
import * as CurrentOrg from "../Services/CurrentOrg"
import * as Projects from "../Services/Projects"
import * as TicketDocs from "../Services/TicketDocs"
import * as Tickets from "../Services/Tickets"
import * as Comments from "../Services/Comments"
import * as Groups from "../Services/Groups"
import * as Tags from "../Services/Tags"
import * as Users from "../Services/Users"
import * as BetterAuth from "../Services/BetterAuth"
import * as ProjectDocs from "../Services/ProjectDocs"
import * as GroupDocs from "../Services/GroupDocs"
import * as TicketIndex from "../Services/TicketIndex"
import { attachmentIndex, organization, projectIndex } from "../db/schema"
import { attachmentUploadRoute } from "../http/attachmentUploadRoutes"
import { handlers } from "./handlers"
import { mapToolError } from "./errorMap"

const user = Schema.decodeSync(User)({
  id: "user-1",
  email: "user@example.com",
  name: "User",
  username: null,
  image: null,
  createdAt: "2026-09-08T00:00:00Z",
  activeOrgSlug: null,
  personalGithub: { connected: false },
  editorPreference: "vscode",
  personalEverhour: {
    connected: false,
    everhourUserId: null,
    name: null,
    email: null,
    lastVerifiedAt: null,
    lastCheckError: null
  }
})
const databaseUrl = process.env.PROJECTPROJECT_TEST_DATABASE_URL
const connection: S3Storage.S3Connection = {
  endpoint: "https://storage.example.test",
  bucket: "test",
  region: "auto",
  keyPrefix: null,
  forcePathStyle: true,
  accessKeyId: "test",
  secretAccessKey: "test"
}
const upload = { filename: "screen.png", contentType: "image/png" }
const bytes = new Uint8Array([137, 80, 78, 71])

const fixture = Effect.fn("attachmentFixture")(function* (
  options: {
    denied?: boolean
    missingTicket?: boolean
    disconnected?: boolean
    failPut?: boolean
    missingObject?: boolean
    storage?: S3Storage.S3Connection
  } = {}
) {
  const db = yield* Db.Db
  const sql = yield* SqlClient.SqlClient
  const slug = `test-${randomUUID()}`
  const scope = {
    orgSlug: slug,
    projectSlug: slug,
    ticketId: yield* Schema.decodeEffect(TicketId)("T-122")
  }
  yield* db
    .insert(organization)
    .values({ id: slug, slug, name: "Test", createdAt: user.createdAt })
  yield* Effect.addFinalizer(() =>
    db.delete(organization).where(eq(organization.id, slug)).pipe(Effect.orDie)
  )
  yield* db.insert(projectIndex).values({
    slug,
    organizationId: slug,
    key: "T",
    name: "Test",
    icon: "",
    color: "#000000",
    createdBy: user.id
  })
  const objects = new Map<string, Uint8Array>()
  const writes: Array<string> = []
  const projects = Layer.mock(Projects.Projects, {
    requireMember: (orgSlug, userId, projectSlug) => {
      expect([orgSlug, userId, projectSlug]).toEqual([slug, user.id, slug])
      return options.denied
        ? Effect.fail(new NotFound())
        : Effect.succeed({ role: "member" })
    }
  })
  const dependencies = Layer.mergeAll(
    Layer.succeed(Db.Db, db),
    Layer.succeed(SqlClient.SqlClient, sql),
    projects,
    SecretCryptoLayer.SecretCryptoLive,
    Layer.mock(CurrentOrg.CurrentOrg, {}),
    Layer.mock(OrgStorage.OrgStorage, {
      requireConnection: () =>
        options.disconnected
          ? Effect.fail(new StorageNotConnected())
          : Effect.succeed(options.storage ?? connection)
    }),
    Layer.mock(TicketDocs.TicketDocs, {
      read: (orgSlug, projectSlug, id) => {
        expect([orgSlug, projectSlug, id]).toEqual([slug, slug, scope.ticketId])
        return options.missingTicket
          ? Effect.fail(new NotFound())
          : Effect.succeed({
              id: scope.ticketId,
              title: "Ticket",
              body: "Original description",
              status: Schema.decodeSync(TicketStatus)("todo"),
              type: "feat",
              priority: "med",
              tags: [],
              branch: null,
              pr: null,
              prState: null,
              lastTransitionedPr: null,
              assignees: [],
              archivedAt: null,
              createdBy: user.id,
              createdAt: user.createdAt,
              updatedAt: user.createdAt
            })
      }
    }),
    options.storage
      ? S3StorageLayer.S3StorageLive
      : Layer.mock(S3Storage.S3Storage, {
          presignPut: (_connection, key) =>
            Effect.succeed(`https://storage.example.test/${key}`),
          putObject: (_connection, key, _contentType, bytes) =>
            options.failPut
              ? Effect.fail(
                  new S3Storage.S3Unavailable({
                    reason: "private upstream details",
                    retryable: true
                  })
                )
              : Effect.sync(() => {
                  writes.push(key)
                  objects.set(key, bytes)
                }),
          headObject: (_connection, key) =>
            Effect.succeed(
              objects.has(key) && !options.missingObject
                ? {
                    byteSize: objects.get(key)!.byteLength,
                    contentType: "image/png",
                    contentHash: null
                  }
                : null
            ),
          deleteObject: (_connection, key) =>
            Effect.sync(() => {
              objects.delete(key)
            })
        })
  )
  const domain = AttachmentUploadsLayer.AttachmentUploadsLive.pipe(
    Layer.provideMerge(AttachmentsLayer.AttachmentsLive),
    Layer.provideMerge(dependencies)
  )
  const context = yield* Layer.build(
    Layer.mergeAll(
      domain,
      Layer.succeed(CurrentUser, user),
      Layer.mock(Tickets.Tickets, {}),
      Layer.mock(Comments.Comments, {}),
      Layer.mock(Groups.Groups, {}),
      Layer.mock(Tags.Tags, {}),
      Layer.mock(Users.Users, {}),
      Layer.mock(BetterAuth.BetterAuth, {}),
      Layer.mock(ProjectDocs.ProjectDocs, {}),
      Layer.mock(GroupDocs.GroupDocs, {}),
      Layer.mock(TicketIndex.TicketIndex, {})
    )
  )
  const prepare = (input = upload) =>
    handlers
      .prepare_ticket_attachment({ ...scope, ...input })
      .pipe(Effect.provide(context))
  const post = (url: string, body = bytes, contentType = upload.contentType) =>
    attachmentUploadRoute.pipe(
      Effect.provide(context),
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request(url, {
            method: "POST",
            headers: { "content-type": contentType },
            body: new Blob([body])
          })
        )
      ),
      Effect.map(HttpServerResponse.toWeb)
    )
  const receive = (
    url: string,
    body: Stream.Stream<Uint8Array>,
    contentType = upload.contentType
  ) =>
    Effect.gen(function* () {
      const uploads = yield* AttachmentUploads.AttachmentUploads
      return yield* uploads.receive(
        new URL(url).searchParams.get("token")!,
        contentType,
        body
      )
    }).pipe(Effect.provide(context))
  const rows = db
    .select()
    .from(attachmentIndex)
    .where(eq(attachmentIndex.orgSlug, slug))
  return { prepare, post, receive, rows, objects, writes, options, scope }
})

describe.skipIf(!databaseUrl)("MCP attachment upload with Postgres", () => {
  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL required")
    const url = new URL(databaseUrl)
    if (
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      !url.pathname.startsWith("/projectproject_effect_v4_")
    )
      throw new Error(
        "Attachment tests require an isolated local test database"
      )
    vi.stubEnv("USER_SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
    const pool = new Pool({ connectionString: databaseUrl })
    try {
      await migrate(drizzle({ client: pool }), {
        migrationsFolder: `${import.meta.dirname}/../db/migrations`
      })
    } finally {
      await pool.end()
    }
  })
  afterAll(() => vi.unstubAllEnvs())
  const dbLayer = DbLayer.DbLive.pipe(
    Layer.provideMerge(
      PgClient.layer({ url: Redacted.make(databaseUrl ?? "") })
    )
  )

  it.effect(
    "POST uploads and commits, and completed retries never replace bytes",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture()
        const prepared = yield* f.prepare()
        expect(new URL(prepared.uploadUrl).pathname).toBe(
          "/api/attachment-uploads"
        )
        expect(prepared.uploadUrl).not.toContain("storage.example.test")
        expect(yield* f.rows).toMatchObject([
          { status: "pending", uploadedBy: user.id }
        ])
        const response = yield* f.post(prepared.uploadUrl)
        expect(response.status).toBe(200)
        expect(response.headers.get("cache-control")).toBe("no-store")
        const committed = yield* Effect.promise(() => response.json())
        expect(committed).toEqual({
          id: prepared.id,
          url: prepared.url,
          filename: upload.filename,
          contentType: upload.contentType
        })
        expect(yield* f.rows).toMatchObject([
          { status: "live", byteSize: bytes.byteLength }
        ])
        const retry = yield* f.post(prepared.uploadUrl, new Uint8Array([1, 2]))
        expect(yield* Effect.promise(() => retry.json())).toEqual(committed)
        expect(f.writes).toHaveLength(1)
        expect([...f.objects.values()].map((value) => [...value])).toEqual([
          [...bytes]
        ])
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect("serializes concurrent uploads to the same grant", () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const prepared = yield* f.prepare()
      const responses = yield* Effect.all(
        [f.post(prepared.uploadUrl), f.post(prepared.uploadUrl)],
        { concurrency: 2 }
      )
      expect(responses.map((r) => r.status)).toEqual([200, 200])
      expect(f.writes).toHaveLength(1)
    }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect("rejects tampered and expired URLs before reading bytes", () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const prepared = yield* f.prepare()
      const url = new URL(prepared.uploadUrl)
      url.searchParams.set("token", "invalid")
      expect(
        (yield* f
          .receive(url.toString(), Stream.die("must not read body"))
          .pipe(Effect.flip))._tag
      ).toBe("Unauthorized")
      const sealedCodec = Schema.fromJsonString(
        Schema.Record(Schema.String, Schema.String)
      )
      const sealed = yield* Schema.decodeEffect(sealedCodec)(
        Buffer.from(
          new URL(prepared.uploadUrl).searchParams.get("token")!,
          "base64url"
        ).toString("utf8")
      )
      const tampered = yield* Schema.encodeEffect(sealedCodec)({
        ...sealed,
        tag: Buffer.alloc(16).toString("base64")
      })
      url.searchParams.set("token", Buffer.from(tampered).toString("base64url"))
      expect(
        (yield* f
          .receive(url.toString(), Stream.die("must not read body"))
          .pipe(Effect.flip))._tag
      ).toBe("Unauthorized")
      yield* TestClock.adjust("15 minutes")
      expect(
        (yield* f
          .receive(prepared.uploadUrl, Stream.die("must not read body"))
          .pipe(Effect.flip))._tag
      ).toBe("Unauthorized")
      expect(f.writes).toHaveLength(0)
    }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect.each([
    { denied: true },
    { missingTicket: true },
    { disconnected: true }
  ])("rejects unavailable resources during prepare: %j", (options) =>
    Effect.gen(function* () {
      const f = yield* fixture(options)
      const error = yield* Effect.flip(f.prepare())
      expect(error._tag).toBe(
        "disconnected" in options ? "StorageNotConnected" : "NotFound"
      )
      expect(yield* f.rows).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect.each(["denied", "missingTicket", "disconnected"] as const)(
    "rechecks %s after issuing the upload URL",
    (state) =>
      Effect.gen(function* () {
        const f = yield* fixture()
        const prepared = yield* f.prepare()
        f.options[state] = true
        expect((yield* f.post(prepared.uploadUrl)).status).toBe(
          state === "disconnected" ? 409 : 404
        )
        expect(f.writes).toHaveLength(0)
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect("rejects unsupported types before persistence", () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      expect(
        (yield* Effect.flip(
          f.prepare({ ...upload, contentType: "text/plain" })
        ))._tag
      ).toBe("AttachmentTypeRejected")
      expect(yield* f.rows).toEqual([])
    }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect(
    "rejects mismatched types and empty/oversized streams without writing to S3",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture()
        const prepared = yield* f.prepare()
        expect(
          (yield* f.post(prepared.uploadUrl, bytes, "text/plain")).status
        ).toBe(415)
        expect(
          (yield* f.post(prepared.uploadUrl, new Uint8Array(0))).status
        ).toBe(413)
        const oversized = Stream.concat(
          Stream.make(new Uint8Array(25 * 1024 * 1024 + 1)),
          Stream.die("must stop reading")
        )
        expect(
          (yield* Effect.flip(f.receive(prepared.uploadUrl, oversized)))._tag
        ).toBe("AttachmentTooLarge")
        expect(f.writes).toHaveLength(0)
        expect((yield* f.post(prepared.uploadUrl)).status).toBe(200)
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect(
    "failed storage writes leave a retryable pending row and hide upstream errors",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ failPut: true })
        const prepared = yield* f.prepare()
        const response = yield* f.post(prepared.uploadUrl)
        expect(response.status).toBe(502)
        expect(yield* Effect.promise(() => response.text())).not.toContain(
          "private upstream details"
        )
        expect(yield* f.rows).toMatchObject([{ status: "pending" }])
        f.options.failPut = false
        expect((yield* f.post(prepared.uploadUrl)).status).toBe(200)
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect(
    "returns metadata only after verifying storage and can retry a failed commit",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture({ missingObject: true })
        const prepared = yield* f.prepare()
        expect((yield* f.post(prepared.uploadUrl)).status).toBe(502)
        expect(yield* f.rows).toMatchObject([{ status: "pending" }])
        f.options.missingObject = false
        expect((yield* f.post(prepared.uploadUrl)).status).toBe(200)
        expect(yield* f.rows).toMatchObject([
          { status: "live", byteSize: bytes.byteLength }
        ])
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect("accepts the full 25 MiB limit and rejects a byte beyond it", () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const size = 25 * 1024 * 1024
      const prepared = yield* f.prepare()
      const maximum = new Uint8Array(size)
      const tooMuch = Stream.make(maximum, new Uint8Array(1))
      expect(
        (yield* Effect.flip(f.receive(prepared.uploadUrl, tooMuch)))._tag
      ).toBe("AttachmentTooLarge")
      expect(f.writes).toHaveLength(0)
      expect(
        (yield* f.receive(
          prepared.uploadUrl,
          Stream.make(maximum.subarray(0, 17), maximum.subarray(17))
        )).id
      ).toBe(prepared.id)
      expect([...f.objects.values()][0]).toHaveLength(size)
      expect(yield* f.rows).toMatchObject([{ byteSize: size, status: "live" }])
    }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect("times out a stalled request without writing to storage", () =>
    Effect.gen(function* () {
      const f = yield* fixture()
      const prepared = yield* f.prepare()
      const fiber = yield* f
        .receive(prepared.uploadUrl, Stream.never)
        .pipe(Effect.flip, Effect.forkChild)
      yield* TestClock.adjust("60 seconds")
      expect((yield* Fiber.join(fiber))._tag).toBe("Validation")
      expect(f.writes).toHaveLength(0)
      expect(yield* f.rows).toMatchObject([{ status: "pending" }])
    }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )

  it.effect.skipIf(!process.env.PROJECTPROJECT_TEST_S3_ENDPOINT)(
    "POST stores original bytes in MinIO and commits automatically",
    () =>
      Effect.gen(function* () {
        const endpoint = process.env.PROJECTPROJECT_TEST_S3_ENDPOINT!
        if (!["127.0.0.1", "localhost"].includes(new URL(endpoint).hostname))
          return yield* Effect.die("S3 test requires local MinIO")
        const storage = {
          ...connection,
          endpoint,
          bucket: `t122-${randomUUID()}`,
          accessKeyId: process.env.PROJECTPROJECT_TEST_S3_ACCESS_KEY!,
          secretAccessKey: process.env.PROJECTPROJECT_TEST_S3_SECRET_KEY!
        }
        const client = yield* Effect.acquireRelease(
          Effect.sync(
            () =>
              new S3Client({
                ...storage,
                credentials: {
                  accessKeyId: storage.accessKeyId,
                  secretAccessKey: storage.secretAccessKey
                }
              })
          ),
          (client) => Effect.sync(() => client.destroy())
        )
        yield* Effect.acquireRelease(
          Effect.promise(() =>
            client.send(new CreateBucketCommand({ Bucket: storage.bucket }))
          ),
          () =>
            Effect.promise(async () => {
              const objects = await client.send(
                new ListObjectsV2Command({ Bucket: storage.bucket })
              )
              for (const object of objects.Contents ?? [])
                await client.send(
                  new DeleteObjectCommand({
                    Bucket: storage.bucket,
                    Key: object.Key
                  })
                )
              await client.send(
                new DeleteBucketCommand({ Bucket: storage.bucket })
              )
            })
        )
        const f = yield* fixture({ storage })
        const prepared = yield* f.prepare()
        expect((yield* f.post(prepared.uploadUrl)).status).toBe(200)
        const [row] = yield* f.rows
        expect(row.status).toBe("live")
        const s3 = yield* S3Storage.S3Storage.pipe(
          Effect.provide(S3StorageLayer.S3StorageLive)
        )
        const url = yield* s3.presignGet(
          storage,
          row.objectKey,
          row.filename,
          false,
          60
        )
        const downloaded = yield* Effect.promise(
          async () => new Uint8Array(await (await fetch(url)).arrayBuffer())
        )
        expect(downloaded).toEqual(bytes)
        return undefined
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
  )
})

describe("MCP attachment contracts", () => {
  it("requires a ticket but no byte size", () => {
    const scope = { orgSlug: "acme", projectSlug: "demo", ticketId: "T-122" }
    expect(
      Schema.is(McpTools.prepare_ticket_attachment.input)({
        ...scope,
        ...upload
      })
    ).toBe(true)
    expect(
      Object.keys(McpTools.prepare_ticket_attachment.input.fields)
    ).not.toContain("byteSize")
    expect(
      Schema.is(McpTools.prepare_ticket_attachment.input)({
        ...scope,
        ...upload,
        ticketId: "bad"
      })
    ).toBe(false)
  })
  it.each([
    new StorageNotConnected(),
    new StorageConfigMissing(),
    new StorageError({ reason: "private upstream details" })
  ])(
    "exposes actionable storage errors without upstream details: $_tag",
    (error) => {
      const result = mapToolError(error)
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain(error._tag)
      expect(result.content[0].text).not.toContain("private upstream details")
    }
  )
})

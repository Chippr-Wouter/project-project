import { beforeAll, describe, expect } from "vite-plus/test"
import { it } from "@effect/vitest"
import { randomUUID } from "node:crypto"
import {
  S3Client,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3"
import * as S3StorageLayer from "../Layers/S3Storage"
import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { PgClient } from "@effect/sql-pg"
import { eq } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
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
import * as Attachments from "../Services/Attachments"
import * as AttachmentsLayer from "../Layers/Attachments"
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
const upload = { filename: "screen.png", contentType: "image/png", byteSize: 4 }

const fixture = Effect.fn("attachmentFixture")(function* (
  options: {
    denied?: boolean
    missingTicket?: boolean
    disconnected?: boolean
    storage?: S3Storage.S3Connection
  } = {}
) {
  const db = yield* Db.Db
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
  const objects = new Map<string, S3Storage.S3ObjectHead>()
  const projects = Layer.mock(Projects.Projects, {
    requireMember: (orgSlug, userId, projectSlug) => {
      expect([orgSlug, userId, projectSlug]).toEqual([slug, user.id, slug])
      return options.denied
        ? Effect.fail(new NotFound())
        : Effect.succeed({ role: "member" })
    }
  })
  const document: TicketDocs.TicketDocs["Service"]["read"] = (
    orgSlug,
    projectSlug,
    id
  ) => {
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
  const dependencies = Layer.mergeAll(
    Layer.succeed(Db.Db, db),
    projects,
    Layer.mock(CurrentOrg.CurrentOrg, {}),
    Layer.mock(OrgStorage.OrgStorage, {
      requireConnection: () =>
        options.disconnected
          ? Effect.fail(new StorageNotConnected())
          : Effect.succeed(options.storage ?? connection)
    }),
    options.storage
      ? S3StorageLayer.S3StorageLive
      : Layer.mock(S3Storage.S3Storage, {
          presignPut: (_connection, key) =>
            Effect.succeed(`https://storage.example.test/${key}`),
          headObject: (_connection, key) =>
            Effect.succeed(objects.get(key) ?? null),
          deleteObject: (_connection, key) =>
            Effect.sync(() => {
              objects.delete(key)
            })
        })
  )
  const layer = Layer.mergeAll(
    AttachmentsLayer.AttachmentsLive.pipe(Layer.provide(dependencies)),
    projects,
    Layer.succeed(CurrentUser, user),
    Layer.mock(TicketDocs.TicketDocs, { read: document }),
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
  const context = yield* Layer.build(layer)
  const prepare = (input = upload) =>
    handlers
      .prepare_ticket_attachment({ ...scope, ...input })
      .pipe(Effect.provide(context))
  const commit = (id: string) =>
    handlers
      .commit_ticket_attachment(
        Schema.decodeSync(McpTools.commit_ticket_attachment.input)({
          ...scope,
          attachmentId: id
        })
      )
      .pipe(Effect.provide(context))
  const rows = db
    .select()
    .from(attachmentIndex)
    .where(eq(attachmentIndex.orgSlug, slug))
  const put = Effect.fn("putTestObject")(function* (
    id: string,
    head: S3Storage.S3ObjectHead
  ) {
    const [row] = yield* db
      .select()
      .from(attachmentIndex)
      .where(eq(attachmentIndex.id, id))
    expect(row).toBeDefined()
    objects.set(row.objectKey, head)
  })
  return { prepare, commit, rows, put, objects, scope, context }
})

describe.skipIf(!databaseUrl)(
  "MCP attachments with real attachment service and Postgres",
  () => {
    beforeAll(async () => {
      if (!databaseUrl) throw new Error("Test database URL required")
      const url = new URL(databaseUrl)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.startsWith("/projectproject_effect_v4_")
      ) {
        throw new Error(
          "Attachment tests require an isolated local test database"
        )
      }
      const pool = new Pool({ connectionString: databaseUrl })
      try {
        await migrate(drizzle({ client: pool }), {
          migrationsFolder: `${import.meta.dirname}/../db/migrations`
        })
      } finally {
        await pool.end()
      }
    })
    const dbLayer = DbLayer.DbLive.pipe(
      Layer.provide(PgClient.layer({ url: Redacted.make(databaseUrl ?? "") }))
    )

    it.effect(
      "persists preparation, validates upload, commits once, and reconciles the markdown reference",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture()
          const prepared = yield* f.prepare()
          expect(
            yield* Schema.encodeEffect(
              McpTools.prepare_ticket_attachment.output
            )(prepared)
          ).toMatchObject({ id: prepared.id, expiresAt: expect.any(String) })
          expect(yield* f.rows).toMatchObject([
            {
              id: prepared.id,
              status: "pending",
              uploadedBy: user.id,
              ticketId: "T-122"
            }
          ])
          yield* f.put(prepared.id, {
            byteSize: 4,
            contentType: "image/png",
            contentHash: null
          })
          const committed = yield* f.commit(prepared.id)
          expect(committed).toEqual({
            id: prepared.id,
            url: prepared.url,
            filename: upload.filename,
            contentType: upload.contentType
          })
          expect(yield* f.commit(prepared.id)).toEqual(committed)
          expect(yield* f.rows).toMatchObject([{ status: "live" }])
          const attachments = yield* Attachments.Attachments.pipe(
            Effect.provide(f.context)
          )
          yield* attachments.reconcileTicket(
            f.scope.orgSlug,
            f.scope.projectSlug,
            f.scope.ticketId,
            `![screen](${committed.url})`
          )
          expect(yield* f.rows).toMatchObject([{ status: "live" }])
          yield* attachments.reconcileTicket(
            f.scope.orgSlug,
            f.scope.projectSlug,
            f.scope.ticketId,
            ""
          )
          expect(yield* f.rows).toMatchObject([{ status: "orphaned" }])
        }).pipe(Effect.scoped, Effect.provide(dbLayer))
    )

    it.effect.skipIf(!process.env.PROJECTPROJECT_TEST_S3_ENDPOINT)(
      "uploads and downloads original bytes through MinIO",
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
                  endpoint,
                  region: storage.region,
                  forcePathStyle: true,
                  credentials: {
                    accessKeyId: storage.accessKeyId,
                    secretAccessKey: storage.secretAccessKey
                  }
                })
            ),
            (client) => Effect.sync(() => client.destroy())
          )
          const keys: Array<string> = []
          yield* Effect.acquireRelease(
            Effect.promise(() =>
              client.send(new CreateBucketCommand({ Bucket: storage.bucket }))
            ),
            () =>
              Effect.promise(async () => {
                for (const Key of keys)
                  await client.send(
                    new DeleteObjectCommand({ Bucket: storage.bucket, Key })
                  )
                await client.send(
                  new DeleteBucketCommand({ Bucket: storage.bucket })
                )
              })
          )
          const f = yield* fixture({ storage })
          const prepared = yield* f.prepare()
          keys.push(...(yield* f.rows).map((row) => row.objectKey))
          const bytes = new Uint8Array([137, 80, 78, 71])
          const response = yield* Effect.promise(() =>
            fetch(prepared.uploadUrl, {
              method: "PUT",
              headers: { "Content-Type": upload.contentType },
              body: bytes
            })
          )
          expect(response.ok).toBe(true)
          const committed = yield* f.commit(prepared.id)
          expect(committed).toMatchObject({
            id: prepared.id,
            contentType: "image/png"
          })
          const s3 = yield* S3Storage.S3Storage.pipe(
            Effect.provide(S3StorageLayer.S3StorageLive)
          )
          const url = yield* s3.presignGet(
            storage,
            keys[0],
            upload.filename,
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

    it.effect.each([
      { contentType: "text/plain", byteSize: 4, tag: "AttachmentTypeRejected" },
      { contentType: "image/png", byteSize: 0, tag: "AttachmentTooLarge" },
      {
        contentType: "image/png",
        byteSize: 25 * 1024 * 1024 + 1,
        tag: "AttachmentTooLarge"
      }
    ])("rejects invalid upload metadata before persisting: $tag", (input) =>
      Effect.gen(function* () {
        const f = yield* fixture()
        const error = yield* Effect.flip(f.prepare({ ...upload, ...input }))
        expect(error._tag).toBe(input.tag)
        expect(yield* f.rows).toEqual([])
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
    )

    it.effect.each([
      { denied: true },
      { missingTicket: true },
      { disconnected: true }
    ])("rejects unavailable resources before preparation: %j", (options) =>
      Effect.gen(function* () {
        const f = yield* fixture(options)
        const error = yield* Effect.flip(f.prepare())
        expect(error._tag).toBe(
          "disconnected" in options ? "StorageNotConnected" : "NotFound"
        )
        expect(yield* f.rows).toEqual([])
        if (error._tag === "StorageNotConnected")
          expect(mapToolError(error).content[0].text).toContain(
            "organization settings"
          )
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
    )

    it.effect(
      "commit before upload leaves the pending record available for retry",
      () =>
        Effect.gen(function* () {
          const f = yield* fixture()
          const prepared = yield* f.prepare()
          const error = yield* Effect.flip(f.commit(prepared.id))
          expect(error._tag).toBe("AttachmentNotUploaded")
          expect(mapToolError(error).content[0].text).toContain(
            "Complete the PUT"
          )
          expect(yield* f.rows).toMatchObject([{ status: "pending" }])
          yield* f.put(prepared.id, {
            byteSize: 4,
            contentType: "image/png",
            contentHash: null
          })
          expect(yield* f.commit(prepared.id)).toMatchObject({
            id: prepared.id
          })
        }).pipe(Effect.scoped, Effect.provide(dbLayer))
    )

    it.effect.each([
      { byteSize: 3, contentType: "image/png", tag: "AttachmentTooLarge" },
      { byteSize: 4, contentType: "text/plain", tag: "AttachmentTypeRejected" }
    ])("removes an invalid uploaded object and pending row: $tag", (head) =>
      Effect.gen(function* () {
        const f = yield* fixture()
        const prepared = yield* f.prepare()
        yield* f.put(prepared.id, { ...head, contentHash: null })
        expect((yield* Effect.flip(f.commit(prepared.id)))._tag).toBe(head.tag)
        expect(yield* f.rows).toEqual([])
        expect(f.objects.size).toBe(0)
      }).pipe(Effect.scoped, Effect.provide(dbLayer))
    )
  }
)

describe("MCP attachment contracts", () => {
  it("rejects malformed identifiers and fractional sizes", () => {
    const scope = { orgSlug: "acme", projectSlug: "demo", ticketId: "T-122" }
    expect(
      Schema.is(McpTools.prepare_ticket_attachment.input)({
        ...scope,
        ...upload,
        byteSize: 1.5
      })
    ).toBe(false)
    expect(
      Schema.is(McpTools.prepare_ticket_attachment.input)({
        ...scope,
        ...upload,
        ticketId: "bad"
      })
    ).toBe(false)
    expect(
      Schema.is(McpTools.commit_ticket_attachment.input)({
        ...scope,
        attachmentId: "bad"
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

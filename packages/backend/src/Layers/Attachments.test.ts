import { it } from "@effect/vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect } from "vite-plus/test"
import {
  ATTACHMENT_MAX_BYTES,
  isAttachmentDeletable,
  NotFound,
  type Role
} from "@projectproject/shared"
import { Attachments } from "../Services/Attachments"
import { CurrentOrg } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import { OrgStorage } from "../Services/OrgStorage"
import { Projects } from "../Services/Projects"
import { S3Storage } from "../Services/S3Storage"
import { AttachmentsLive } from "./Attachments"

const at = (iso: string) => DateTime.toDate(DateTime.makeUnsafe(iso))
import {
  attachmentServesInline,
  attachmentPageOffset,
  attachmentSortPlan,
  isServableStatus,
  ORPHAN_GRACE_MS,
  planReap,
  planDedupe,
  planReferences,
  summarizeAttachments,
  planStatuses,
  validateUploadRequest
} from "../Services/Attachments"

describe("validateUploadRequest", () => {
  it("accepts an allowed type within the cap", () => {
    expect(
      validateUploadRequest({ contentType: "image/png", byteSize: 1024 })
    ).toBeNull()
  })

  it("rejects svg", () => {
    expect(
      validateUploadRequest({ contentType: "image/svg+xml", byteSize: 1024 })
    ).toEqual({ kind: "type", contentType: "image/svg+xml" })
  })

  it("rejects an executable", () => {
    expect(
      validateUploadRequest({
        contentType: "application/x-msdownload",
        byteSize: 1024
      })
    ).toEqual({ kind: "type", contentType: "application/x-msdownload" })
  })

  it("rejects a file over the cap", () => {
    expect(
      validateUploadRequest({
        contentType: "image/png",
        byteSize: ATTACHMENT_MAX_BYTES + 1
      })
    ).toEqual({ kind: "size", maxBytes: ATTACHMENT_MAX_BYTES })
  })

  it("accepts a file exactly at the cap", () => {
    expect(
      validateUploadRequest({
        contentType: "image/png",
        byteSize: ATTACHMENT_MAX_BYTES
      })
    ).toBeNull()
  })

  it("rejects a zero-byte file", () => {
    expect(
      validateUploadRequest({ contentType: "image/png", byteSize: 0 })
    ).toEqual({ kind: "size", maxBytes: ATTACHMENT_MAX_BYTES })
  })

  it("checks the type before the size", () => {
    expect(
      validateUploadRequest({
        contentType: "image/svg+xml",
        byteSize: ATTACHMENT_MAX_BYTES + 1
      })
    ).toEqual({ kind: "type", contentType: "image/svg+xml" })
  })

  it("tolerates a content type with parameters", () => {
    expect(
      validateUploadRequest({
        contentType: "image/png; charset=binary",
        byteSize: 10
      })
    ).toBeNull()
  })
})

describe("planReferences", () => {
  it("adds a reference for an attachment the body newly mentions", () => {
    expect(
      planReferences({ referenced: new Set(["a"]), existing: [] })
    ).toEqual({ toAdd: ["a"], toRemove: [] })
  })

  it("drops a reference the body no longer mentions", () => {
    expect(planReferences({ referenced: new Set(), existing: ["a"] })).toEqual({
      toAdd: [],
      toRemove: ["a"]
    })
  })

  it("leaves an unchanged reference alone", () => {
    expect(
      planReferences({ referenced: new Set(["a"]), existing: ["a"] })
    ).toEqual({ toAdd: [], toRemove: [] })
  })

  it("adds and drops in the same edit", () => {
    expect(
      planReferences({ referenced: new Set(["a", "b"]), existing: ["b", "c"] })
    ).toEqual({ toAdd: ["a"], toRemove: ["c"] })
  })

  it("counts a duplicated mention once", () => {
    expect(
      planReferences({ referenced: new Set(["a"]), existing: [] })
    ).toEqual({ toAdd: ["a"], toRemove: [] })
  })
})

describe("planStatuses", () => {
  it("keeps an attachment live while any ticket still references it", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "live" }],
        referenceCounts: new Map([["a", 2]])
      })
    ).toEqual({ toLive: [], toOrphan: [] })
  })

  it("orphans an attachment only when its last reference goes", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "live" }],
        referenceCounts: new Map([["a", 0]])
      })
    ).toEqual({ toLive: [], toOrphan: ["a"] })
  })

  it("does not orphan an attachment that another ticket still references", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "live" }],
        referenceCounts: new Map([["a", 1]])
      })
    ).toEqual({ toLive: [], toOrphan: [] })
  })

  it("restores an orphaned attachment that a ticket references again", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "orphaned" }],
        referenceCounts: new Map([["a", 1]])
      })
    ).toEqual({ toLive: ["a"], toOrphan: [] })
  })

  it("leaves a referenced pending row pending, so commit still gets to validate the object", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "pending" }],
        referenceCounts: new Map([["a", 1]])
      })
    ).toEqual({ toLive: [], toOrphan: [] })
  })

  it("leaves an unreferenced pending row pending, since its upload may still land", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "pending" }],
        referenceCounts: new Map([["a", 0]])
      })
    ).toEqual({ toLive: [], toOrphan: [] })
  })

  it("treats a missing count as no references", () => {
    expect(
      planStatuses({
        rows: [{ id: "a", status: "live" }],
        referenceCounts: new Map()
      })
    ).toEqual({ toLive: [], toOrphan: ["a"] })
  })
})

describe("planReap", () => {
  const now = Date.UTC(2026, 8, 2)

  it("reaps a pending row past its ttl", () => {
    expect(
      planReap({
        now,
        rows: [
          {
            id: "a",
            status: "pending",
            // @effect-diagnostics-next-line globalDate:off
            createdAt: new Date(now - 2 * 60 * 60 * 1000),
            orphanedAt: null
          }
        ]
      })
    ).toEqual(["a"])
  })

  it("spares a pending row inside its ttl", () => {
    expect(
      planReap({
        now,
        rows: [
          {
            id: "a",
            status: "pending",
            // @effect-diagnostics-next-line globalDate:off
            createdAt: new Date(now - 60 * 1000),
            orphanedAt: null
          }
        ]
      })
    ).toEqual([])
  })

  it("reaps an orphaned row past the grace period", () => {
    expect(
      planReap({
        now,
        rows: [
          {
            id: "a",
            status: "orphaned",
            // @effect-diagnostics-next-line globalDate:off
            createdAt: new Date(now - ORPHAN_GRACE_MS * 2),
            // @effect-diagnostics-next-line globalDate:off
            orphanedAt: new Date(now - ORPHAN_GRACE_MS - 1000)
          }
        ]
      })
    ).toEqual(["a"])
  })

  it("spares an orphaned row inside the grace period", () => {
    expect(
      planReap({
        now,
        rows: [
          {
            id: "a",
            status: "orphaned",
            // @effect-diagnostics-next-line globalDate:off
            createdAt: new Date(now - ORPHAN_GRACE_MS * 2),
            // @effect-diagnostics-next-line globalDate:off
            orphanedAt: new Date(now - 1000)
          }
        ]
      })
    ).toEqual([])
  })

  it("never reaps a live row", () => {
    expect(
      planReap({
        now,
        rows: [
          {
            id: "a",
            status: "live",
            // @effect-diagnostics-next-line globalDate:off
            createdAt: new Date(now - ORPHAN_GRACE_MS * 10),
            orphanedAt: null
          }
        ]
      })
    ).toEqual([])
  })

  it("spares an orphaned row with a null orphanedAt", () => {
    expect(
      planReap({
        now,
        rows: [
          {
            id: "a",
            status: "orphaned",
            // @effect-diagnostics-next-line globalDate:off
            createdAt: new Date(now - ORPHAN_GRACE_MS * 10),
            orphanedAt: null
          }
        ]
      })
    ).toEqual([])
  })
})

describe("isServableStatus", () => {
  it("serves a live attachment", () => {
    expect(isServableStatus("live")).toBe(true)
  })

  it("serves an orphaned attachment, so undoing a removal shows the image again rather than a load error", () => {
    expect(isServableStatus("orphaned")).toBe(true)
  })

  it("refuses a pending attachment, whose object may not exist yet", () => {
    expect(isServableStatus("pending")).toBe(false)
  })
})

describe("isAttachmentDeletable", () => {
  it("allows deleting an orphaned attachment", () => {
    expect(isAttachmentDeletable({ status: "orphaned" })).toBe(true)
  })

  it("allows deleting a live attachment, leaving the reference broken in its ticket", () => {
    expect(isAttachmentDeletable({ status: "live" })).toBe(true)
  })

  it("refuses a pending attachment, whose upload may still be in flight", () => {
    expect(isAttachmentDeletable({ status: "pending" })).toBe(false)
  })
})

describe("attachmentSortPlan", () => {
  it("sorts newest first by default", () => {
    expect(attachmentSortPlan(undefined)).toEqual({
      column: "createdAt",
      direction: "desc"
    })
  })

  it("sorts oldest first", () => {
    expect(attachmentSortPlan("created_asc")).toEqual({
      column: "createdAt",
      direction: "asc"
    })
  })

  it("sorts biggest first, so the bucket hogs surface at the top", () => {
    expect(attachmentSortPlan("size_desc")).toEqual({
      column: "byteSize",
      direction: "desc"
    })
  })

  it("sorts smallest first", () => {
    expect(attachmentSortPlan("size_asc")).toEqual({
      column: "byteSize",
      direction: "asc"
    })
  })
})

const servingRow = {
  id: "att-1",
  organizationId: "org-1",
  orgSlug: "acme",
  projectSlug: "apollo",
  ticketId: "T-1",
  objectKey: "orgs/acme/projects/apollo/tickets/T-1/att-1-shot.png",
  filename: "shot.png",
  contentType: "image/png",
  byteSize: 1024,
  status: "live" as const,
  uploadedBy: "user-2",
  createdAt: at("2026-09-02T10:00:00.000Z"),
  committedAt: at("2026-09-02T10:00:01.000Z"),
  orphanedAt: null
}

const servingDb = Layer.succeed(Db, {
  select: () => ({
    from: () => ({
      where: () => ({ limit: () => Effect.succeed([servingRow]) })
    })
  })
} as never)

const connection = {
  endpoint: "https://acct.r2.cloudflarestorage.com",
  bucket: "pp",
  region: "auto",
  keyPrefix: null,
  forcePathStyle: true,
  accessKeyId: "key",
  secretAccessKey: "secret"
}

const stubOrgStorage = Layer.succeed(OrgStorage, {
  requireConnection: () => Effect.succeed(connection)
} as never)

const stubS3 = Layer.succeed(S3Storage, {
  presignGet: () => Effect.succeed("https://signed.example/shot.png")
} as never)

const nonMemberProjects = Layer.succeed(Projects, {
  requireMember: () => Effect.fail(new NotFound())
} as never)

const stubCurrentOrg = (role: Role) =>
  Layer.succeed(CurrentOrg, {
    resolve: () =>
      Effect.succeed({ organizationId: "org-1", orgSlug: "acme", role })
  } as never)

const servingLayer = (role: Role) =>
  AttachmentsLive.pipe(
    Layer.provide(servingDb),
    Layer.provide(stubOrgStorage),
    Layer.provide(stubS3),
    Layer.provide(nonMemberProjects),
    Layer.provide(stubCurrentOrg(role))
  )

const resolveAs = (role: Role) =>
  Attachments.pipe(
    Effect.flatMap((attachments) =>
      Effect.result(attachments.resolveForServing("acme", "att-1", "user-1"))
    ),
    Effect.provide(servingLayer(role))
  )

describe("resolveForServing beyond project membership", () => {
  it.effect(
    "serves an org owner who is not a member of the owning project, so the admin attachments browser can render thumbnails",
    () =>
      Effect.gen(function* () {
        const result = yield* resolveAs("owner")
        expect(result._tag).toBe("Success")
      })
  )

  it.effect("serves an org admin who is not a project member", () =>
    Effect.gen(function* () {
      const result = yield* resolveAs("admin")
      expect(result._tag).toBe("Success")
    })
  )

  it.effect("refuses a plain member who is not on the owning project", () =>
    Effect.gen(function* () {
      const result = yield* resolveAs("member")
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("Forbidden")
      }
    })
  )
})

const deletionHarness = (input: {
  readonly status: "pending" | "live" | "orphaned"
  readonly role: Role
  readonly rowVanished?: boolean
  readonly sharers?: ReadonlyArray<{
    readonly id: string
    readonly objectKey: string
  }>
}) => {
  const deletedKeys: Array<string> = []
  const deletedRows: Array<unknown> = []
  const order: Array<string> = []
  const layer = AttachmentsLive.pipe(
    Layer.provide(
      Layer.succeed(Db, {
        select: (shape?: Record<string, unknown>) => ({
          from: () => ({
            where: (cond: unknown) => {
              void cond
              const isSharerQuery = shape !== undefined
              return {
                limit: () =>
                  Effect.succeed(
                    isSharerQuery
                      ? (input.sharers ?? [])
                      : [{ ...servingRow, status: input.status }]
                  )
              }
            }
          })
        }),
        delete: () => ({
          where: (cond: unknown) => ({
            returning: () => {
              order.push("row")
              deletedRows.push(cond)
              return Effect.succeed(
                input.rowVanished === true ? [] : [{ id: servingRow.id }]
              )
            }
          })
        })
      } as never)
    ),
    Layer.provide(stubOrgStorage),
    Layer.provide(
      Layer.succeed(S3Storage, {
        deleteObject: (_: unknown, key: string) => {
          order.push("s3")
          deletedKeys.push(key)
          return Effect.void
        }
      } as never)
    ),
    Layer.provide(nonMemberProjects),
    Layer.provide(stubCurrentOrg(input.role))
  )
  const run = Attachments.pipe(
    Effect.flatMap((attachments) =>
      Effect.result(attachments.deleteForOrg("acme", "att-1", "user-1"))
    ),
    Effect.provide(layer)
  )
  return { run, deletedKeys, deletedRows, order }
}

describe("deleteForOrg", () => {
  it.effect("deletes the object and the row for an orphaned attachment", () =>
    Effect.gen(function* () {
      const harness = deletionHarness({ status: "orphaned", role: "owner" })
      const result = yield* harness.run
      expect(result._tag).toBe("Success")
      expect(harness.deletedKeys).toEqual([servingRow.objectKey])
      expect(harness.deletedRows).toHaveLength(1)
    })
  )

  it.effect(
    "deletes a live attachment, breaking the reference in its ticket",
    () =>
      Effect.gen(function* () {
        const harness = deletionHarness({ status: "live", role: "owner" })
        const result = yield* harness.run
        expect(result._tag).toBe("Success")
        expect(harness.deletedKeys).toEqual([servingRow.objectKey])
        expect(harness.deletedRows).toHaveLength(1)
      })
  )

  it.effect("refuses a pending attachment whose upload may still land", () =>
    Effect.gen(function* () {
      const harness = deletionHarness({ status: "pending", role: "owner" })
      const result = yield* harness.run
      expect(result._tag).toBe("Failure")
      expect(harness.deletedKeys).toEqual([])
    })
  )

  it.effect(
    "narrows the delete on status, so a row that became pending since the read is spared",
    () =>
      Effect.gen(function* () {
        const harness = deletionHarness({ status: "orphaned", role: "owner" })
        yield* harness.run
        expect(sqlOf(harness.deletedRows[0])).toContain("status")
      })
  )

  it.effect(
    "deletes the row before the object, so a row that changed state never loses its object",
    () =>
      Effect.gen(function* () {
        const harness = deletionHarness({ status: "orphaned", role: "owner" })
        yield* harness.run
        expect(harness.order).toEqual(["row", "s3"])
      })
  )

  it.effect(
    "leaves the object alone when the guarded delete matches nothing",
    () =>
      Effect.gen(function* () {
        const harness = deletionHarness({
          status: "orphaned",
          role: "owner",
          rowVanished: true
        })
        const result = yield* harness.run
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure")
          expect(result.failure._tag).toBe("Forbidden")
        expect(harness.deletedKeys).toEqual([])
      })
  )

  it.effect(
    "spares the object when a deduplicated row still points at it",
    () =>
      Effect.gen(function* () {
        const harness = deletionHarness({
          status: "orphaned",
          role: "owner",
          sharers: [{ id: "att-2", objectKey: servingRow.objectKey }]
        })
        const result = yield* harness.run
        expect(result._tag).toBe("Success")
        expect(harness.deletedRows).toHaveLength(1)
        expect(harness.deletedKeys).toEqual([])
      })
  )

  it.effect("refuses a plain member, even for an orphaned attachment", () =>
    Effect.gen(function* () {
      const harness = deletionHarness({ status: "orphaned", role: "member" })
      const result = yield* harness.run
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure")
        expect(result.failure._tag).toBe("Forbidden")
      expect(harness.deletedKeys).toEqual([])
    })
  )
})

const dialect = new PgDialect()
const sqlOf = (cond: unknown) => dialect.sqlToQuery(cond as never).sql

const listHarness = (input: {
  readonly role: Role
  readonly rows?: ReadonlyArray<unknown>
  readonly total?: number
  readonly references?: ReadonlyArray<{
    readonly attachmentId: string
    readonly projectSlug: string
    readonly ticketId: string
  }>
}) => {
  const capture: {
    where?: unknown
    limit?: number
    offset?: number
    groupBy?: unknown
  } = {}
  const rows = input.rows ?? []
  const layer = AttachmentsLive.pipe(
    Layer.provide(
      Layer.succeed(Db, {
        select: (shape?: Record<string, unknown>) => ({
          from: () => ({
            where: (cond: unknown) => {
              capture.where = cond
              const isReferenceQuery =
                shape !== undefined && "attachmentId" in shape
              const isSummaryQuery = shape !== undefined && "objectKey" in shape
              const settled = Effect.succeed(
                isReferenceQuery
                  ? (input.references ?? [])
                  : isSummaryQuery
                    ? rows
                    : [{ total: input.total ?? 0 }]
              ) as unknown as Record<string, unknown>
              settled["orderBy"] = () => ({
                limit: (n: number) => {
                  capture.limit = n
                  return {
                    offset: (o: number) => {
                      capture.offset = o
                      return Effect.succeed(rows)
                    }
                  }
                }
              })
              settled["groupBy"] = (grouped: unknown) => {
                capture.groupBy = grouped
                return Effect.succeed(rows)
              }
              return settled
            }
          })
        })
      } as never)
    ),
    Layer.provide(stubOrgStorage),
    Layer.provide(stubS3),
    Layer.provide(nonMemberProjects),
    Layer.provide(stubCurrentOrg(input.role))
  )
  return { capture, layer }
}

describe("listForOrg", () => {
  it.effect("refuses a plain member", () =>
    Effect.gen(function* () {
      const { layer } = listHarness({ role: "member" })
      const result = yield* Attachments.pipe(
        Effect.flatMap((a) =>
          Effect.result(a.listForOrg("acme", "user-1", {}))
        ),
        Effect.provide(layer)
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure")
        expect(result.failure._tag).toBe("Forbidden")
    })
  )

  it.effect("scopes the query to the org", () =>
    Effect.gen(function* () {
      const { layer, capture } = listHarness({ role: "owner" })
      yield* Attachments.pipe(
        Effect.flatMap((a) => a.listForOrg("acme", "user-1", {})),
        Effect.provide(layer)
      )
      expect(sqlOf(capture.where)).toContain("org_slug")
    })
  )

  it.effect("narrows to a status and a project when both are filtered", () =>
    Effect.gen(function* () {
      const { layer, capture } = listHarness({ role: "owner" })
      yield* Attachments.pipe(
        Effect.flatMap((a) =>
          a.listForOrg("acme", "user-1", {
            status: "orphaned",
            projectSlug: "apollo"
          })
        ),
        Effect.provide(layer)
      )
      const where = sqlOf(capture.where)
      expect(where).toContain("status")
      expect(where).toContain("project_slug")
    })
  )

  it.effect("offsets to the requested page", () =>
    Effect.gen(function* () {
      const { layer, capture } = listHarness({ role: "owner" })
      yield* Attachments.pipe(
        Effect.flatMap((a) =>
          a.listForOrg("acme", "user-1", { page: 3, limit: 25 })
        ),
        Effect.provide(layer)
      )
      expect(capture.limit).toBe(25)
      expect(capture.offset).toBe(50)
    })
  )

  it.effect("reports the total matching the filters, not just this page", () =>
    Effect.gen(function* () {
      const { layer } = listHarness({
        role: "owner",
        rows: [servingRow],
        total: 217
      })
      const page = yield* Attachments.pipe(
        Effect.flatMap((a) => a.listForOrg("acme", "user-1", {})),
        Effect.provide(layer)
      )
      expect(page.total).toBe(217)
    })
  )

  it.effect("lists every ticket that references an attachment", () =>
    Effect.gen(function* () {
      const { layer } = listHarness({
        role: "owner",
        rows: [servingRow],
        total: 1,
        references: [
          {
            attachmentId: servingRow.id,
            projectSlug: "apollo",
            ticketId: "T-1"
          },
          {
            attachmentId: servingRow.id,
            projectSlug: "apollo",
            ticketId: "T-9"
          }
        ]
      })
      const page = yield* Attachments.pipe(
        Effect.flatMap((a) => a.listForOrg("acme", "user-1", {})),
        Effect.provide(layer)
      )
      expect(page.items[0]?.tickets).toEqual([
        { projectSlug: "apollo", ticketId: "T-1" },
        { projectSlug: "apollo", ticketId: "T-9" }
      ])
    })
  )

  it.effect(
    "leaves the ticket list empty for an attachment nothing references",
    () =>
      Effect.gen(function* () {
        const { layer } = listHarness({
          role: "owner",
          rows: [servingRow],
          total: 1,
          references: []
        })
        const page = yield* Attachments.pipe(
          Effect.flatMap((a) => a.listForOrg("acme", "user-1", {})),
          Effect.provide(layer)
        )
        expect(page.items[0]?.tickets).toEqual([])
      })
  )

  it.effect("returns rows shaped for the browser table", () =>
    Effect.gen(function* () {
      const { layer } = listHarness({
        role: "owner",
        rows: [servingRow],
        total: 1
      })
      const page = yield* Attachments.pipe(
        Effect.flatMap((a) => a.listForOrg("acme", "user-1", {})),
        Effect.provide(layer)
      )
      expect(page.total).toBe(1)
      expect(page.items[0]).toMatchObject({
        tickets: [],
        id: "att-1",
        projectSlug: "apollo",
        ticketId: "T-1",
        filename: "shot.png",
        status: "live"
      })
    })
  )
})

describe("summarizeForOrg", () => {
  it.effect("refuses a plain member", () =>
    Effect.gen(function* () {
      const { layer } = listHarness({ role: "member" })
      const result = yield* Attachments.pipe(
        Effect.flatMap((a) =>
          Effect.result(a.summarizeForOrg("acme", "user-1"))
        ),
        Effect.provide(layer)
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure")
        expect(result.failure._tag).toBe("Forbidden")
    })
  )

  it.effect(
    "leaves pending bytes out of the headline totals, since the object may never have landed",
    () =>
      Effect.gen(function* () {
        const { layer } = listHarness({
          role: "owner",
          rows: [
            { objectKey: "k-a", byteSize: 300, status: "live" },
            { objectKey: "k-b", byteSize: 900, status: "pending" }
          ]
        })
        const summary = yield* Attachments.pipe(
          Effect.flatMap((a) => a.summarizeForOrg("acme", "user-1")),
          Effect.provide(layer)
        )
        expect(summary.count).toBe(1)
        expect(summary.bytes).toBe(300)
        expect(summary.byStatus).toContainEqual({
          status: "pending",
          count: 1,
          bytes: 900
        })
      })
  )

  it.effect("totals count and bytes across the statuses", () =>
    Effect.gen(function* () {
      const { layer } = listHarness({
        role: "owner",
        rows: [
          { objectKey: "k-a", byteSize: 100, status: "live" },
          { objectKey: "k-b", byteSize: 100, status: "live" },
          { objectKey: "k-c", byteSize: 100, status: "live" },
          { objectKey: "k-d", byteSize: 100, status: "orphaned" },
          { objectKey: "k-e", byteSize: 100, status: "orphaned" }
        ]
      })
      const summary = yield* Attachments.pipe(
        Effect.flatMap((a) => a.summarizeForOrg("acme", "user-1")),
        Effect.provide(layer)
      )
      expect(summary.count).toBe(5)
      expect(summary.bytes).toBe(500)
      expect(summary.byStatus).toEqual([
        { status: "live", count: 3, bytes: 300 },
        { status: "orphaned", count: 2, bytes: 200 }
      ])
    })
  )
})

describe("attachmentPageOffset", () => {
  it("starts the first page at the top", () => {
    expect(attachmentPageOffset(1, 50)).toBe(0)
  })

  it("treats a missing page as the first", () => {
    expect(attachmentPageOffset(undefined, 50)).toBe(0)
  })

  it("skips a whole page for the second page", () => {
    expect(attachmentPageOffset(2, 50)).toBe(50)
  })

  it("scales with the page size", () => {
    expect(attachmentPageOffset(3, 25)).toBe(50)
  })

  it("never offsets backwards", () => {
    expect(attachmentPageOffset(0, 50)).toBe(0)
  })
})

describe("attachmentServesInline", () => {
  it("renders a raster image in the page", () => {
    expect(
      attachmentServesInline({ contentType: "image/png", download: false })
    ).toBe(true)
  })

  it("downloads a pdf rather than opening it in the page", () => {
    expect(
      attachmentServesInline({
        contentType: "application/pdf",
        download: false
      })
    ).toBe(false)
  })

  it("downloads an image when the caller asked for a download", () => {
    expect(
      attachmentServesInline({ contentType: "image/png", download: true })
    ).toBe(false)
  })
})

describe("planDedupe", () => {
  const row = (input: {
    id: string
    key: string
    hash: string | null
    size?: number
    at?: string
  }) => ({
    id: input.id,
    objectKey: input.key,
    contentHash: input.hash,
    byteSize: input.size ?? 100,
    createdAt: at(input.at ?? "2026-09-02T10:00:00.000Z")
  })

  it("repoints a later duplicate at the earliest copy's object", () => {
    expect(
      planDedupe({
        rows: [
          row({
            id: "a",
            key: "k-a",
            hash: "h",
            at: "2026-09-01T00:00:00.000Z"
          }),
          row({
            id: "b",
            key: "k-b",
            hash: "h",
            at: "2026-09-02T00:00:00.000Z"
          })
        ]
      })
    ).toEqual([{ id: "b", fromKey: "k-b", toKey: "k-a" }])
  })

  it("leaves a lone copy alone", () => {
    expect(
      planDedupe({ rows: [row({ id: "a", key: "k-a", hash: "h" })] })
    ).toEqual([])
  })

  it("never merges rows whose hashes differ", () => {
    expect(
      planDedupe({
        rows: [
          row({ id: "a", key: "k-a", hash: "h1" }),
          row({ id: "b", key: "k-b", hash: "h2" })
        ]
      })
    ).toEqual([])
  })

  it("never merges a matching hash at a different size", () => {
    expect(
      planDedupe({
        rows: [
          row({ id: "a", key: "k-a", hash: "h", size: 100 }),
          row({ id: "b", key: "k-b", hash: "h", size: 200 })
        ]
      })
    ).toEqual([])
  })

  it("skips rows whose hash is not known yet", () => {
    expect(
      planDedupe({
        rows: [
          row({ id: "a", key: "k-a", hash: null }),
          row({ id: "b", key: "k-b", hash: null })
        ]
      })
    ).toEqual([])
  })

  it("leaves a duplicate that already shares the canonical object", () => {
    expect(
      planDedupe({
        rows: [
          row({
            id: "a",
            key: "k-a",
            hash: "h",
            at: "2026-09-01T00:00:00.000Z"
          }),
          row({
            id: "b",
            key: "k-a",
            hash: "h",
            at: "2026-09-02T00:00:00.000Z"
          })
        ]
      })
    ).toEqual([])
  })

  it("collapses a whole group onto one object", () => {
    const plan = planDedupe({
      rows: [
        row({ id: "a", key: "k-a", hash: "h", at: "2026-09-01T00:00:00.000Z" }),
        row({ id: "b", key: "k-b", hash: "h", at: "2026-09-02T00:00:00.000Z" }),
        row({ id: "c", key: "k-c", hash: "h", at: "2026-09-03T00:00:00.000Z" })
      ]
    })
    expect(plan.map((entry) => entry.id)).toEqual(["b", "c"])
    expect(plan.every((entry) => entry.toKey === "k-a")).toBe(true)
  })
})

describe("summarizeAttachments", () => {
  it("counts every row and its bytes when nothing is shared", () => {
    expect(
      summarizeAttachments({
        rows: [
          { objectKey: "k-a", byteSize: 100, status: "live" },
          { objectKey: "k-b", byteSize: 200, status: "orphaned" }
        ]
      })
    ).toEqual({
      byStatus: [
        { status: "live", count: 1, bytes: 100 },
        { status: "orphaned", count: 1, bytes: 200 }
      ],
      count: 2,
      bytes: 300
    })
  })

  it("charges a deduplicated object's bytes once, not once per row", () => {
    const summary = summarizeAttachments({
      rows: [
        { objectKey: "k", byteSize: 100, status: "live" },
        { objectKey: "k", byteSize: 100, status: "live" }
      ]
    })
    expect(summary.count).toBe(2)
    expect(summary.bytes).toBe(100)
  })

  it("charges a shared object to its live row rather than the orphaned one", () => {
    const summary = summarizeAttachments({
      rows: [
        { objectKey: "k", byteSize: 100, status: "orphaned" },
        { objectKey: "k", byteSize: 100, status: "live" }
      ]
    })
    expect(summary.byStatus).toEqual([
      { status: "live", count: 1, bytes: 100 },
      { status: "orphaned", count: 1, bytes: 0 }
    ])
  })

  it("leaves pending bytes out of the headline, since the object may not exist", () => {
    const summary = summarizeAttachments({
      rows: [
        { objectKey: "k-a", byteSize: 100, status: "live" },
        { objectKey: "k-b", byteSize: 900, status: "pending" }
      ]
    })
    expect(summary.count).toBe(1)
    expect(summary.bytes).toBe(100)
    expect(summary.byStatus).toContainEqual({
      status: "pending",
      count: 1,
      bytes: 900
    })
  })

  it("reports zeroes for an empty bucket", () => {
    expect(summarizeAttachments({ rows: [] })).toEqual({
      byStatus: [],
      count: 0,
      bytes: 0
    })
  })
})

describe("missingIds", () => {
  const resolvableHarness = (rows: ReadonlyArray<{ id: string }>) => {
    const capture: { where?: unknown } = {}
    return {
      capture,
      layer: AttachmentsLive.pipe(
        Layer.provide(
          Layer.succeed(Db, {
            select: () => ({
              from: () => ({
                where: (cond: unknown) => {
                  capture.where = cond
                  return Effect.succeed(rows)
                }
              })
            })
          } as never)
        ),
        Layer.provide(stubOrgStorage),
        Layer.provide(stubS3),
        Layer.provide(nonMemberProjects),
        Layer.provide(stubCurrentOrg("owner"))
      )
    }
  }

  it.effect("names only the referenced ids that no longer resolve", () =>
    Effect.gen(function* () {
      const { layer } = resolvableHarness([{ id: "a" }, { id: "c" }])
      const ids = yield* Attachments.pipe(
        Effect.flatMap((a) => a.missingIds("acme", ["a", "b", "c"])),
        Effect.provide(layer)
      )
      expect(ids).toEqual(["b"])
    })
  )

  it.effect("names nothing when every referenced id resolves", () =>
    Effect.gen(function* () {
      const { layer } = resolvableHarness([{ id: "a" }])
      const ids = yield* Attachments.pipe(
        Effect.flatMap((a) => a.missingIds("acme", ["a"])),
        Effect.provide(layer)
      )
      expect(ids).toEqual([])
    })
  )

  it.effect("asks for nothing when the body references nothing", () =>
    Effect.gen(function* () {
      const { layer, capture } = resolvableHarness([])
      const ids = yield* Attachments.pipe(
        Effect.flatMap((a) => a.missingIds("acme", [])),
        Effect.provide(layer)
      )
      expect(ids).toEqual([])
      expect(capture.where).toBeUndefined()
    })
  )

  it.effect(
    "only counts a servable status, so a pending upload reads as missing",
    () =>
      Effect.gen(function* () {
        const { layer, capture } = resolvableHarness([{ id: "a" }])
        yield* Attachments.pipe(
          Effect.flatMap((a) => a.missingIds("acme", ["a"])),
          Effect.provide(layer)
        )
        const where = sqlOf(capture.where)
        expect(where).toContain("status")
        expect(where).toContain("org_slug")
      })
  )
})

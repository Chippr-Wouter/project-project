import { and, eq, isNull } from "drizzle-orm"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import {
  Conflict,
  Forbidden,
  NotFound,
  ORG_DELETE_GRACE_DAYS,
  type OrgDetail,
  Role
} from "@projectproject/shared"
import { member, organization } from "../db/schema"
import { CurrentOrg } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import { Org, type OrgShape } from "../Services/Org"

const makeRole = Schema.decodeUnknownSync(Role)

const purgeAtFor = (deletedAt: Date): Date =>
  DateTime.toDate(
    DateTime.add(DateTime.fromDateUnsafe(deletedAt), {
      days: ORG_DELETE_GRACE_DAYS
    })
  )

interface OrgRow {
  readonly organizationId: string
  readonly slug: string
  readonly name: string
  readonly role: string
  readonly createdAt: Date
  readonly deletedAt: Date | null
}

const toDetail = (row: OrgRow, deletedAt: Date | null): OrgDetail => ({
  id: row.organizationId,
  slug: row.slug,
  name: row.name,
  role: makeRole(row.role),
  createdAt: row.createdAt,
  deletedAt,
  purgeAt: deletedAt ? purgeAtFor(deletedAt) : null
})

export const OrgLive = Layer.effect(
  Org,
  Effect.gen(function* () {
    const db = yield* Db
    const currentOrg = yield* CurrentOrg

    const getRow = (
      orgSlug: string,
      userId: string
    ): Effect.Effect<OrgRow | null> =>
      db
        .select({
          organizationId: organization.id,
          slug: organization.slug,
          name: organization.name,
          role: member.role,
          createdAt: organization.createdAt,
          deletedAt: organization.deletedAt
        })
        .from(organization)
        .innerJoin(
          member,
          and(
            eq(member.organizationId, organization.id),
            eq(member.userId, userId)
          )
        )
        .where(eq(organization.slug, orgSlug))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0] ?? null)
        )

    const myOrgs: OrgShape["myOrgs"] = (userId) =>
      db
        .select({
          slug: organization.slug,
          name: organization.name,
          role: member.role
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(and(eq(member.userId, userId), isNull(organization.deletedAt)))
        .pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row) => ({
              slug: row.slug,
              name: row.name,
              role: makeRole(row.role)
            }))
          )
        )

    const get: OrgShape["get"] = (orgSlug, userId) =>
      getRow(orgSlug, userId).pipe(
        Effect.flatMap((row) =>
          row
            ? Effect.succeed(toDetail(row, row.deletedAt))
            : Effect.fail(new NotFound())
        )
      )

    const softDelete: OrgShape["softDelete"] = (orgSlug, userId) =>
      Effect.gen(function* () {
        const resolved = yield* currentOrg.resolve(orgSlug, userId)
        if (resolved.role !== "owner") {
          return yield* new Forbidden()
        }
        const row = yield* getRow(orgSlug, userId)
        if (!row) {
          return yield* new NotFound()
        }
        const now = DateTime.toDate(yield* DateTime.now)
        yield* db
          .update(organization)
          .set({ deletedAt: now })
          .where(
            and(
              eq(organization.id, resolved.organizationId),
              isNull(organization.deletedAt)
            )
          )
          .pipe(Effect.orDie)
        return toDetail(row, now)
      })

    const restore: OrgShape["restore"] = (orgSlug, userId) =>
      Effect.gen(function* () {
        const row = yield* getRow(orgSlug, userId)
        if (!row) {
          return yield* new NotFound()
        }
        if (row.role !== "owner") {
          return yield* new Forbidden()
        }
        if (!row.deletedAt) {
          return yield* new Conflict({ reason: "not_deleted" })
        }
        const nowMs = DateTime.toEpochMillis(yield* DateTime.now)
        if (nowMs > purgeAtFor(row.deletedAt).getTime()) {
          return yield* new Conflict({ reason: "grace_expired" })
        }
        yield* db
          .update(organization)
          .set({ deletedAt: null })
          .where(
            and(
              eq(organization.id, row.organizationId),
              eq(organization.deletedAt, row.deletedAt)
            )
          )
          .pipe(Effect.orDie)
        return toDetail(row, null)
      })

    return { myOrgs, get, softDelete, restore } satisfies OrgShape
  })
)

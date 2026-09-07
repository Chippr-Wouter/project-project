import { it } from "@effect/vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as TestClock from "effect/testing/TestClock"
import { expect } from "vite-plus/test"
import { member } from "../db/schema"
import { CurrentOrg, type CurrentOrgShape } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import { Org } from "../Services/Org"
import { OrgLive } from "./Org"

const NOW = "2026-05-19T00:00:00.000Z"
const setNow = TestClock.setTime(
  DateTime.toEpochMillis(DateTime.makeUnsafe(NOW))
)

const dialect = new PgDialect()
const sqlOf = (cond: unknown) => dialect.sqlToQuery(cond as never).sql

const isoDate = (s: string) => DateTime.toDate(DateTime.makeUnsafe(s))
const nowDate = isoDate(NOW)
const daysBefore = (n: number) =>
  DateTime.toDate(DateTime.subtract(DateTime.makeUnsafe(NOW), { days: n }))
const plusGrace = (d: Date) =>
  DateTime.toDate(DateTime.add(DateTime.fromDateUnsafe(d), { days: 14 }))

interface OrgRowLike {
  readonly organizationId: string
  readonly slug: string
  readonly name: string
  readonly role: string
  readonly createdAt: Date
  readonly deletedAt: Date | null
}

interface Capture {
  myOrgsWhere?: unknown
  getWhere?: unknown
  updateSet?: { deletedAt: Date | null }
  updateWhere?: unknown
}

interface DbState {
  orgRow?: OrgRowLike | null
  myOrgRows?: ReadonlyArray<{ slug: string; name: string; role: string }>
  capture: Capture
}

const makeState = (init: Omit<DbState, "capture"> = {}): DbState => ({
  orgRow: init.orgRow,
  myOrgRows: init.myOrgRows,
  capture: {}
})

const makeDb = (state: DbState) =>
  Layer.succeed(Db, {
    select: () => ({
      from: (table: unknown) => {
        if (table === member) {
          return {
            innerJoin: () => ({
              where: (cond: unknown) => {
                state.capture.myOrgsWhere = cond
                return Effect.succeed(state.myOrgRows ?? [])
              }
            })
          }
        }
        return {
          innerJoin: () => ({
            where: (cond: unknown) => {
              state.capture.getWhere = cond
              return {
                limit: () => Effect.succeed(state.orgRow ? [state.orgRow] : [])
              }
            }
          })
        }
      }
    }),
    update: () => ({
      set: (values: { deletedAt: Date | null }) => {
        state.capture.updateSet = values
        return {
          where: (cond: unknown) => {
            state.capture.updateWhere = cond
            return Effect.succeed([])
          }
        }
      }
    })
  } as never)

const dieResolve: CurrentOrgShape["resolve"] = () =>
  Effect.die("unexpected currentOrg.resolve")

const makeOrgLayer = (
  state: DbState,
  resolve: CurrentOrgShape["resolve"] = dieResolve
) =>
  OrgLive.pipe(
    Layer.provide(
      Layer.merge(makeDb(state), Layer.succeed(CurrentOrg, { resolve }))
    )
  )

const ownerResolve: CurrentOrgShape["resolve"] = () =>
  Effect.succeed({ organizationId: "org-1", orgSlug: "acme", role: "owner" })
const memberResolve: CurrentOrgShape["resolve"] = () =>
  Effect.succeed({ organizationId: "org-1", orgSlug: "acme", role: "member" })

it.effect("myOrgs maps rows and filters deleted in the query", () =>
  Effect.gen(function* () {
    const state = makeState({
      myOrgRows: [
        { slug: "acme", name: "Acme", role: "owner" },
        { slug: "beta", name: "Beta", role: "member" }
      ]
    })
    const org = yield* Org.pipe(Effect.provide(makeOrgLayer(state)))
    const orgs = yield* org.myOrgs("user-1")
    expect(orgs).toEqual([
      { slug: "acme", name: "Acme", role: "owner" },
      { slug: "beta", name: "Beta", role: "member" }
    ])
    const where = sqlOf(state.capture.myOrgsWhere)
    expect(where).toContain("deleted_at")
    expect(where).toContain("is null")
  })
)

it.effect(
  "get surfaces deletedAt and computed purgeAt for a soft-deleted org",
  () =>
    Effect.gen(function* () {
      const deletedAt = daysBefore(3)
      const org = yield* Org
      const detail = yield* org.get("acme", "user-1")
      expect(detail.id).toBe("org-1")
      expect(detail.slug).toBe("acme")
      expect(detail.role).toBe("admin")
      expect(detail.deletedAt).toEqual(deletedAt)
      expect(detail.purgeAt).toEqual(plusGrace(deletedAt))
    }).pipe(
      Effect.provide(
        makeOrgLayer(
          makeState({
            orgRow: {
              organizationId: "org-1",
              slug: "acme",
              name: "Acme",
              role: "admin",
              createdAt: isoDate("2026-01-01T00:00:00.000Z"),
              deletedAt: daysBefore(3)
            }
          })
        )
      )
    )
)

it.effect("get returns null deletedAt/purgeAt for a live org", () =>
  Effect.gen(function* () {
    const org = yield* Org
    const detail = yield* org.get("acme", "user-1")
    expect(detail.deletedAt).toBeNull()
    expect(detail.purgeAt).toBeNull()
  }).pipe(
    Effect.provide(
      makeOrgLayer(
        makeState({
          orgRow: {
            organizationId: "org-1",
            slug: "acme",
            name: "Acme",
            role: "owner",
            createdAt: isoDate("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        })
      )
    )
  )
)

it.effect("get requires membership", () =>
  Effect.gen(function* () {
    const org = yield* Org
    const result = yield* Effect.result(org.get("acme", "user-1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NotFound")
    }
  }).pipe(Effect.provide(makeOrgLayer(makeState({ orgRow: null }))))
)

it.effect("softDelete sets deletedAt for an owner", () =>
  Effect.gen(function* () {
    yield* setNow
    const state = makeState({
      orgRow: {
        organizationId: "org-1",
        slug: "acme",
        name: "Acme",
        role: "owner",
        createdAt: isoDate("2026-01-01T00:00:00.000Z"),
        deletedAt: null
      }
    })
    const org = yield* Org.pipe(
      Effect.provide(makeOrgLayer(state, ownerResolve))
    )
    const detail = yield* org.softDelete("acme", "user-1")
    expect(detail.deletedAt).toEqual(nowDate)
    expect(detail.purgeAt).toEqual(plusGrace(nowDate))
    expect(state.capture.updateSet?.deletedAt).toEqual(nowDate)
  })
)

it.effect("softDelete is owner-only", () =>
  Effect.gen(function* () {
    const org = yield* Org
    const result = yield* Effect.result(org.softDelete("acme", "user-1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Forbidden")
    }
  }).pipe(Effect.provide(makeOrgLayer(makeState(), memberResolve)))
)

it.effect("restore clears deletedAt for an owner within the grace window", () =>
  Effect.gen(function* () {
    yield* setNow
    const state = makeState({
      orgRow: {
        organizationId: "org-1",
        slug: "acme",
        name: "Acme",
        role: "owner",
        createdAt: isoDate("2026-01-01T00:00:00.000Z"),
        deletedAt: daysBefore(5)
      }
    })
    const org = yield* Org.pipe(Effect.provide(makeOrgLayer(state)))
    const detail = yield* org.restore("acme", "user-1")
    expect(detail.deletedAt).toBeNull()
    expect(detail.purgeAt).toBeNull()
    expect(state.capture.updateSet?.deletedAt).toBeNull()
  })
)

it.effect("restore rejects a past-grace org with Conflict", () =>
  Effect.gen(function* () {
    yield* setNow
    const org = yield* Org
    const result = yield* Effect.result(org.restore("acme", "user-1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Conflict")
    }
  }).pipe(
    Effect.provide(
      makeOrgLayer(
        makeState({
          orgRow: {
            organizationId: "org-1",
            slug: "acme",
            name: "Acme",
            role: "owner",
            createdAt: isoDate("2026-01-01T00:00:00.000Z"),
            deletedAt: daysBefore(20)
          }
        })
      )
    )
  )
)

it.effect("restore rejects a live org with Conflict", () =>
  Effect.gen(function* () {
    yield* setNow
    const org = yield* Org
    const result = yield* Effect.result(org.restore("acme", "user-1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Conflict")
    }
  }).pipe(
    Effect.provide(
      makeOrgLayer(
        makeState({
          orgRow: {
            organizationId: "org-1",
            slug: "acme",
            name: "Acme",
            role: "owner",
            createdAt: isoDate("2026-01-01T00:00:00.000Z"),
            deletedAt: null
          }
        })
      )
    )
  )
)

it.effect("restore is owner-only", () =>
  Effect.gen(function* () {
    yield* setNow
    const org = yield* Org
    const result = yield* Effect.result(org.restore("acme", "user-1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("Forbidden")
    }
  }).pipe(
    Effect.provide(
      makeOrgLayer(
        makeState({
          orgRow: {
            organizationId: "org-1",
            slug: "acme",
            name: "Acme",
            role: "member",
            createdAt: isoDate("2026-01-01T00:00:00.000Z"),
            deletedAt: daysBefore(5)
          }
        })
      )
    )
  )
)

it.effect("restore requires membership", () =>
  Effect.gen(function* () {
    const org = yield* Org
    const result = yield* Effect.result(org.restore("acme", "user-1"))
    expect(result._tag).toBe("Failure")
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NotFound")
    }
  }).pipe(Effect.provide(makeOrgLayer(makeState({ orgRow: null }))))
)

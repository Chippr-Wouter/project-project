import { it } from "@effect/vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect } from "vite-plus/test"
import { Db } from "../Services/Db"
import { CurrentOrg, isOrgAdminRole } from "../Services/CurrentOrg"
import { CurrentOrgLive } from "./CurrentOrg"

const dialect = new PgDialect()
const sqlOf = (cond: unknown) => dialect.sqlToQuery(cond as never).sql

interface Capture {
  where?: unknown
}

const makeDb = (rows: ReadonlyArray<unknown>, capture: Capture) =>
  Layer.succeed(Db, {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (cond: unknown) => {
            capture.where = cond
            return { limit: () => Effect.succeed(rows) }
          }
        })
      })
    })
  } as never)

it.effect(
  "resolve filters out soft-deleted orgs and returns NotFound when no live membership row",
  () =>
    Effect.gen(function* () {
      const capture: Capture = {}
      const result = yield* CurrentOrg.pipe(
        Effect.flatMap((currentOrg) =>
          Effect.result(currentOrg.resolve("acme", "user-1"))
        ),
        Effect.provide(CurrentOrgLive.pipe(Layer.provide(makeDb([], capture))))
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("NotFound")
      }
      const where = sqlOf(capture.where)
      expect(where).toContain("deleted_at")
      expect(where).toContain("is null")
    })
)

describe("isOrgAdminRole", () => {
  it("admits an owner", () => {
    expect(isOrgAdminRole("owner")).toBe(true)
  })

  it("admits an admin", () => {
    expect(isOrgAdminRole("admin")).toBe(true)
  })

  it("refuses a plain member", () => {
    expect(isOrgAdminRole("member")).toBe(false)
  })
})

// Users service — read-only helpers over Better Auth's user table.
//
// We don't go through Better Auth's API for these because (a) Better Auth's
// public API is signed-in-user-shaped, not "look up someone else", and
// (b) we already have a Drizzle client for our own queries. Hitting the
// shared user table directly is the simplest seam.
//
// Surface stays small on purpose: only what Projects (and later Tickets'
// assignee resolution) actually need.

import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { eq, inArray } from "drizzle-orm"
import type { User } from "@projectproject/shared"
import { user } from "../db/schema"
import { Db } from "../Services/Db"
import { Users, type UsersShape, type UserSummary } from "../Services/Users"

const userColumns = {
  id: true,
  email: true,
  name: true,
  username: true
} as const

export const UsersLive = Layer.effect(
  Users,
  Effect.gen(function* () {
    const db = yield* Db

    const findByEmail = (email: string): Effect.Effect<UserSummary | null> =>
      db.query.user
        .findFirst({
          columns: userColumns,
          where: eq(user.email, email.toLowerCase())
        })
        .pipe(
          Effect.map((row) => row ?? null),
          Effect.orDie
        )

    const findManyByIds = (
      ids: ReadonlyArray<string>
    ): Effect.Effect<ReadonlyArray<UserSummary>> => {
      if (ids.length === 0) return Effect.succeed([])
      return db.query.user
        .findMany({
          columns: userColumns,
          where: inArray(user.id, [...ids])
        })
        .pipe(Effect.orDie)
    }

    const fullByIds = (
      ids: ReadonlyArray<string>
    ): Effect.Effect<ReadonlyArray<User>> => {
      if (ids.length === 0) return Effect.succeed([])
      return db.query.user
        .findMany({
          columns: {
            id: true,
            email: true,
            name: true,
            username: true,
            image: true,
            createdAt: true
          },
          where: inArray(user.id, [...ids])
        })
        .pipe(
          Effect.map((rows) =>
            rows.map((r): User => ({
              id: r.id,
              email: r.email,
              name: r.name,
              username: r.username,
              image: r.image ?? null,
              createdAt: r.createdAt,
              activeOrgSlug: null,
              personalGithub: {
                connected: false
              },
              editorPreference: "github",
              personalEverhour: {
                connected: false,
                everhourUserId: null,
                name: null,
                email: null,
                lastVerifiedAt: null,
                lastCheckError: null
              }
            }))
          ),
          Effect.orDie
        )
    }

    return { findByEmail, findManyByIds, fullByIds } satisfies UsersShape
  })
)

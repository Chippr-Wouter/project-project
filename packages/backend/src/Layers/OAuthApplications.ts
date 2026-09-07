import * as SqlClient from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { and, desc, eq, max } from "drizzle-orm"
import { NotFound, type OAuthApplication } from "@projectproject/shared"
import {
  oauthAccessToken,
  oauthClient,
  oauthConsent,
  oauthRefreshToken
} from "../db/auth-schema"
import { Db } from "../Services/Db"
import {
  OAuthApplications,
  type OAuthApplicationsShape
} from "../Services/OAuthApplications"

export const OAuthApplicationsLive = Layer.effect(
  OAuthApplications,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient

    const listForUser = (
      userId: string
    ): Effect.Effect<ReadonlyArray<OAuthApplication>> =>
      Effect.tryPromise(() =>
        db
          .select({
            id: oauthClient.id,
            name: oauthClient.name,
            clientId: oauthClient.clientId,
            createdAt: oauthClient.createdAt,
            lastAccessAt: max(oauthAccessToken.createdAt),
            lastRefreshAt: max(oauthRefreshToken.createdAt)
          })
          .from(oauthConsent)
          .innerJoin(
            oauthClient,
            eq(oauthConsent.clientId, oauthClient.clientId)
          )
          .leftJoin(
            oauthAccessToken,
            and(
              eq(oauthAccessToken.clientId, oauthClient.clientId),
              eq(oauthAccessToken.userId, userId)
            )
          )
          .leftJoin(
            oauthRefreshToken,
            and(
              eq(oauthRefreshToken.clientId, oauthClient.clientId),
              eq(oauthRefreshToken.userId, userId)
            )
          )
          .where(eq(oauthConsent.userId, userId))
          .groupBy(
            oauthClient.id,
            oauthClient.name,
            oauthClient.clientId,
            oauthClient.createdAt
          )
          .orderBy(desc(max(oauthAccessToken.createdAt)))
      ).pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows.flatMap((row): ReadonlyArray<OAuthApplication> => {
            if (!row.createdAt) return []
            const timestamps = [row.lastAccessAt, row.lastRefreshAt].filter(
              (value): value is Date => value instanceof Date
            )
            const lastUsedAt = timestamps.reduce<Date | null>(
              (latest, value) =>
                latest === null || value > latest ? value : latest,
              null
            )
            return [
              {
                id: row.id,
                name: row.name ?? row.clientId,
                clientId: row.clientId,
                createdAt: row.createdAt,
                lastUsedAt
              }
            ]
          })
        )
      )

    const revokeForUser = (
      userId: string,
      applicationId: string
    ): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        const existing = yield* Effect.tryPromise(() =>
          db
            .select({ clientId: oauthClient.clientId })
            .from(oauthClient)
            .innerJoin(
              oauthConsent,
              eq(oauthConsent.clientId, oauthClient.clientId)
            )
            .where(
              and(
                eq(oauthClient.id, applicationId),
                eq(oauthConsent.userId, userId)
              )
            )
            .limit(1)
        ).pipe(Effect.orDie)
        const clientId = existing[0]?.clientId
        if (!clientId) return yield* new NotFound()

        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* db
                .delete(oauthRefreshToken)
                .where(
                  and(
                    eq(oauthRefreshToken.clientId, clientId),
                    eq(oauthRefreshToken.userId, userId)
                  )
                )
                .pipe(Effect.asVoid, Effect.orDie)
              yield* db
                .delete(oauthAccessToken)
                .where(
                  and(
                    eq(oauthAccessToken.clientId, clientId),
                    eq(oauthAccessToken.userId, userId)
                  )
                )
                .pipe(Effect.asVoid, Effect.orDie)
              yield* db
                .delete(oauthConsent)
                .where(
                  and(
                    eq(oauthConsent.clientId, clientId),
                    eq(oauthConsent.userId, userId)
                  )
                )
                .pipe(Effect.asVoid, Effect.orDie)
            })
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))
      })

    return { listForUser, revokeForUser } satisfies OAuthApplicationsShape
  })
)

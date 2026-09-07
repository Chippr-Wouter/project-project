import { and, eq, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
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

    const listForUser = (
      userId: string
    ): Effect.Effect<ReadonlyArray<OAuthApplication>> =>
      Effect.suspend(() => {
        const access = db
          .select({
            clientId: oauthAccessToken.clientId,
            lastUsedAt: sql<Date | null>`max(${oauthAccessToken.createdAt})`.as(
              "last_access_at"
            )
          })
          .from(oauthAccessToken)
          .where(eq(oauthAccessToken.userId, userId))
          .groupBy(oauthAccessToken.clientId)
          .as("access")
        const refresh = db
          .select({
            clientId: oauthRefreshToken.clientId,
            lastUsedAt:
              sql<Date | null>`max(${oauthRefreshToken.createdAt})`.as(
                "last_refresh_at"
              )
          })
          .from(oauthRefreshToken)
          .where(eq(oauthRefreshToken.userId, userId))
          .groupBy(oauthRefreshToken.clientId)
          .as("refresh")
        return db
          .select({
            id: oauthClient.id,
            name: oauthClient.name,
            clientId: oauthClient.clientId,
            createdAt: oauthClient.createdAt,
            lastAccessAt: access.lastUsedAt,
            lastRefreshAt: refresh.lastUsedAt
          })
          .from(oauthConsent)
          .innerJoin(
            oauthClient,
            eq(oauthConsent.clientId, oauthClient.clientId)
          )
          .leftJoin(access, eq(access.clientId, oauthClient.clientId))
          .leftJoin(refresh, eq(refresh.clientId, oauthClient.clientId))
          .where(eq(oauthConsent.userId, userId))
          .groupBy(
            oauthClient.id,
            oauthClient.name,
            oauthClient.clientId,
            oauthClient.createdAt,
            access.lastUsedAt,
            refresh.lastUsedAt
          )
      }).pipe(
        Effect.orDie,
        Effect.map((rows) =>
          rows
            .flatMap((row): ReadonlyArray<OAuthApplication> => {
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
            .sort(
              (a, b) =>
                (b.lastUsedAt?.getTime() ?? -Infinity) -
                (a.lastUsedAt?.getTime() ?? -Infinity)
            )
        )
      )

    const revokeForUser = (
      userId: string,
      applicationId: string
    ): Effect.Effect<void, NotFound> =>
      Effect.gen(function* () {
        const existing = yield* db
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
          .pipe(Effect.orDie)

        const row = existing[0]
        if (!row) return yield* new NotFound()

        yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .delete(oauthRefreshToken)
                .where(
                  and(
                    eq(oauthRefreshToken.clientId, row.clientId),
                    eq(oauthRefreshToken.userId, userId)
                  )
                )
              yield* tx
                .delete(oauthAccessToken)
                .where(
                  and(
                    eq(oauthAccessToken.clientId, row.clientId),
                    eq(oauthAccessToken.userId, userId)
                  )
                )
              yield* tx
                .delete(oauthConsent)
                .where(
                  and(
                    eq(oauthConsent.clientId, row.clientId),
                    eq(oauthConsent.userId, userId)
                  )
                )
            })
          )
          .pipe(Effect.orDie)
      })

    return { listForUser, revokeForUser } satisfies OAuthApplicationsShape
  })
)

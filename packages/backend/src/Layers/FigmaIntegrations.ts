import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Redacted from "effect/Redacted"
import * as SqlClient from "@effect/sql/SqlClient"
import type { PgRemoteDatabase } from "drizzle-orm/pg-proxy"
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm"
import { createHash, randomBytes } from "node:crypto"
import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected,
  Forbidden,
  NotFound,
  StorageNotConnected,
  type FigmaProjectIntegrationStatus,
  type PersonalFigma
} from "@projectproject/shared"
import {
  member as orgMember,
  organizationIntegration,
  projectFigmaIntegration,
  projectIntegrationLink,
  projectMember,
  userFigmaIntegration,
  userFigmaOauthState
} from "../db/schema"
import type * as schema from "../db/schema"
import { Db } from "../Services/Db"
import { Figma, type FigmaCredential } from "../Services/Figma"
import {
  chooseCredential,
  FigmaIntegrations,
  isTokenExpired,
  type FigmaIntegrationsShape
} from "../Services/FigmaIntegrations"
import { OrgStorage } from "../Services/OrgStorage"
import { SecretCrypto } from "../Services/SecretCrypto"
import { TicketIndex } from "../Services/TicketIndex"

export const FIGMA_SCOPES =
  "file_content:read file_metadata:read file_dev_resources:read file_dev_resources:write"

export const FIGMA_OAUTH_CALLBACK_PATH =
  "/api/integrations/figma/oauth/callback"

const FIGMA_API_BASE = "https://api.figma.com"

const FIGMA_AUTHORIZE_URL = "https://www.figma.com/oauth"

const STATE_TTL_MINUTES = 10

const DEFAULT_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60

export interface FigmaTokenGrant {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: Date
}

export interface FigmaOAuthClient {
  readonly clientId: string
  readonly clientSecret: Redacted.Redacted<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const hashState = (state: string) =>
  createHash("sha256").update(state).digest("hex")

const publicBaseUrl = Config.string("BETTER_AUTH_URL").pipe(
  Config.withDefault("http://localhost:5173")
)

export const figmaOAuthClient: Effect.Effect<FigmaOAuthClient, FigmaError> =
  Effect.all({
    clientId: Config.string("FIGMA_CLIENT_ID"),
    clientSecret: Config.redacted("FIGMA_CLIENT_SECRET")
  }).pipe(
    Effect.mapError(
      () => new FigmaError({ reason: "figma_oauth_unconfigured" })
    )
  )

export const figmaRedirectUri = (baseUrl: string): string =>
  new URL(FIGMA_OAUTH_CALLBACK_PATH, baseUrl).toString()

export const figmaAuthorizeUrl = (input: {
  readonly clientId: string
  readonly redirectUri: string
  readonly state: string
}): string => {
  const url = new URL(FIGMA_AUTHORIZE_URL)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("scope", FIGMA_SCOPES)
  url.searchParams.set("state", input.state)
  url.searchParams.set("response_type", "code")
  return url.toString()
}

const basicAuthorization = (client: FigmaOAuthClient) =>
  `Basic ${Buffer.from(
    `${client.clientId}:${Redacted.value(client.clientSecret)}`
  ).toString("base64")}`

const postForm = <E>(
  url: string,
  client: FigmaOAuthClient,
  form: Record<string, string>,
  onError: () => E
) =>
  Effect.tryPromise({
    try: () =>
      fetch(url, {
        method: "POST",
        headers: {
          Authorization: basicAuthorization(client),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams(form).toString()
      }),
    catch: onError
  })

const readJson = <E>(response: Response, onError: () => E) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: onError
  })

export const toTokenGrant = (
  payload: unknown,
  now: Date,
  fallbackRefreshToken: string | null
): FigmaTokenGrant | null => {
  if (!isRecord(payload)) return null
  const accessToken = payload.access_token
  if (typeof accessToken !== "string" || accessToken.length === 0) return null
  const rotated = payload.refresh_token
  const refreshToken =
    typeof rotated === "string" && rotated.length > 0
      ? rotated
      : fallbackRefreshToken
  if (refreshToken === null) return null
  const expiresIn = payload.expires_in
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : DEFAULT_TOKEN_TTL_SECONDS
  return {
    accessToken,
    refreshToken,
    expiresAt: DateTime.toDate(
      DateTime.add(DateTime.unsafeFromDate(now), { seconds })
    )
  }
}

export const exchangeAuthorizationCode = (input: {
  readonly client: FigmaOAuthClient
  readonly redirectUri: string
  readonly code: string
  readonly now: Date
}): Effect.Effect<FigmaTokenGrant, FigmaAuthInvalid | FigmaError> =>
  Effect.gen(function* () {
    const response = yield* postForm(
      `${FIGMA_API_BASE}/v1/oauth/token`,
      input.client,
      {
        redirect_uri: input.redirectUri,
        code: input.code,
        grant_type: "authorization_code"
      },
      () => new FigmaError({ reason: "figma_token_exchange_unreachable" })
    )
    if (!response.ok) return yield* new FigmaAuthInvalid()
    const payload = yield* readJson(
      response,
      () => new FigmaError({ reason: "figma_token_response_unreadable" })
    )
    const grant = toTokenGrant(payload, input.now, null)
    if (grant === null) {
      return yield* new FigmaError({ reason: "figma_token_response_invalid" })
    }
    return grant
  })

export const isGrantRejection = (status: number): boolean =>
  status === 400 || status === 401

export const refreshAccessToken = (input: {
  readonly client: FigmaOAuthClient
  readonly refreshToken: string
  readonly now: Date
}): Effect.Effect<FigmaTokenGrant, FigmaAuthInvalid | FigmaError> =>
  Effect.gen(function* () {
    const response = yield* postForm(
      `${FIGMA_API_BASE}/v1/oauth/refresh`,
      input.client,
      { refresh_token: input.refreshToken },
      () => new FigmaError({ reason: "figma_refresh_unreachable" })
    )
    if (isGrantRejection(response.status)) return yield* new FigmaAuthInvalid()
    if (!response.ok) {
      return yield* new FigmaError({ reason: "figma_refresh_unavailable" })
    }
    const payload = yield* readJson(
      response,
      () => new FigmaError({ reason: "figma_refresh_response_unreadable" })
    )
    const grant = toTokenGrant(payload, input.now, input.refreshToken)
    if (grant === null) {
      return yield* new FigmaError({ reason: "figma_refresh_response_invalid" })
    }
    return grant
  })

export interface PersonalCredential {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: Date
}

export const resolveCredential = <E = never>(input: {
  readonly personal: PersonalCredential | null
  readonly projectToken: string | null
  readonly now: Date
  readonly refresh: (
    refreshToken: string
  ) => Effect.Effect<FigmaTokenGrant, FigmaAuthInvalid | FigmaError>
  readonly persist: (grant: FigmaTokenGrant) => Effect.Effect<void, E>
  readonly onGrantRejected: Effect.Effect<void>
}): Effect.Effect<
  FigmaCredential,
  FigmaNotConnected | FigmaAuthInvalid | FigmaError | E
> =>
  Effect.gen(function* () {
    const personal = input.personal
    const chosen = chooseCredential({
      personalToken: personal?.accessToken ?? null,
      projectToken: input.projectToken
    })
    if (chosen === null) return yield* new FigmaNotConnected()
    if (chosen._tag !== "Bearer" || personal === null) return chosen
    if (!isTokenExpired(personal.expiresAt, input.now)) return chosen
    const grant = yield* input
      .refresh(personal.refreshToken)
      .pipe(
        Effect.tapError((error) =>
          error._tag === "FigmaAuthInvalid"
            ? input.onGrantRejected
            : Effect.void
        )
      )
    yield* input.persist(grant)
    return { _tag: "Bearer", token: grant.accessToken }
  })

export const consumeOauthStateQuery = (
  db: PgRemoteDatabase<typeof schema>,
  userId: string,
  state: string,
  now: Date
) =>
  db
    .update(userFigmaOauthState)
    .set({ consumedAt: now })
    .where(
      and(
        eq(userFigmaOauthState.stateHash, hashState(state)),
        eq(userFigmaOauthState.userId, userId),
        isNull(userFigmaOauthState.consumedAt),
        gt(userFigmaOauthState.expiresAt, now)
      )
    )
    .returning({ id: userFigmaOauthState.id })

export const requireConsumedState = (
  rows: ReadonlyArray<{ readonly id: string }>
): Effect.Effect<void, FigmaAuthInvalid> =>
  rows.length === 0 ? Effect.fail(new FigmaAuthInvalid()) : Effect.void

export const startOauthFlow = (input: {
  readonly db: PgRemoteDatabase<typeof schema>
  readonly client: Effect.Effect<FigmaOAuthClient, FigmaError>
  readonly redirectUri: Effect.Effect<string>
  readonly userId: string
}): Effect.Effect<
  { readonly authorizeUrl: string; readonly state: string },
  FigmaError
> =>
  Effect.gen(function* () {
    const { clientId } = yield* input.client
    const uri = yield* input.redirectUri
    const state = randomBytes(32).toString("base64url")
    const now = yield* DateTime.now
    const expiresAt = DateTime.toDate(
      DateTime.add(now, { minutes: STATE_TTL_MINUTES })
    )
    yield* input.db
      .insert(userFigmaOauthState)
      .values({ userId: input.userId, stateHash: hashState(state), expiresAt })
      .pipe(Effect.orDie)
    return {
      authorizeUrl: figmaAuthorizeUrl({ clientId, redirectUri: uri, state }),
      state
    }
  })

const notConnectedStatus = (
  storageConnected: boolean
): FigmaProjectIntegrationStatus => ({
  connected: false,
  handle: null,
  connectedAt: null,
  lastCheckStatus: null,
  lastCheckError: null,
  storageConnected
})

export const FigmaIntegrationsLive = Layer.effect(
  FigmaIntegrations,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const figma = yield* Figma
    const secrets = yield* SecretCrypto
    const orgStorage = yield* OrgStorage
    const ticketIndex = yield* TicketIndex

    const client = figmaOAuthClient

    const redirectUri = publicBaseUrl.pipe(
      Effect.orDie,
      Effect.map(figmaRedirectUri)
    )

    const getProfile = (userId: string): Effect.Effect<PersonalFigma> =>
      db.query.userFigmaIntegration
        .findFirst({
          columns: {
            figmaUserId: true,
            handle: true,
            email: true,
            lastVerifiedAt: true,
            lastCheckError: true
          },
          where: eq(userFigmaIntegration.userId, userId)
        })
        .pipe(
          Effect.orDie,
          Effect.map((row) => ({
            connected: row !== undefined,
            figmaUserId: row?.figmaUserId ?? null,
            handle: row?.handle ?? null,
            email: row?.email ?? null,
            lastVerifiedAt:
              row?.lastVerifiedAt == null
                ? null
                : DateTime.unsafeFromDate(row.lastVerifiedAt),
            lastCheckError: row?.lastCheckError ?? null
          }))
        )

    const beginProfileConnect = (userId: string) =>
      startOauthFlow({ db, client, redirectUri, userId })

    const consumeState = (userId: string, state: string) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        const consumed = yield* consumeOauthStateQuery(
          db,
          userId,
          state,
          now
        ).pipe(Effect.orDie)
        yield* requireConsumedState(consumed)
      })

    const sealToken = (token: string) =>
      secrets
        .seal(token)
        .pipe(
          Effect.mapError(
            () => new FigmaError({ reason: "figma_secret_storage_unavailable" })
          )
        )

    const openToken = (sealed: {
      readonly ciphertext: string
      readonly nonce: string
      readonly tag: string
    }) =>
      secrets
        .open(sealed)
        .pipe(
          Effect.mapError(
            () => new FigmaError({ reason: "figma_secret_storage_unavailable" })
          )
        )

    const persistPersonalGrant = (
      userId: string,
      grant: FigmaTokenGrant,
      now: Date
    ) =>
      Effect.gen(function* () {
        const access = yield* sealToken(grant.accessToken)
        const refresh = yield* sealToken(grant.refreshToken)
        yield* db
          .update(userFigmaIntegration)
          .set({
            encryptedAccessToken: access.ciphertext,
            accessTokenNonce: access.nonce,
            accessTokenTag: access.tag,
            encryptedRefreshToken: refresh.ciphertext,
            refreshTokenNonce: refresh.nonce,
            refreshTokenTag: refresh.tag,
            expiresAt: grant.expiresAt,
            updatedAt: now,
            lastVerifiedAt: now,
            lastCheckStatus: "ok",
            lastCheckError: null
          })
          .where(eq(userFigmaIntegration.userId, userId))
          .pipe(Effect.orDie)
      })

    const markPersonalBroken = (userId: string, reason: string) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        yield* db
          .update(userFigmaIntegration)
          .set({
            updatedAt: now,
            lastCheckStatus: "error",
            lastCheckError: reason
          })
          .where(eq(userFigmaIntegration.userId, userId))
          .pipe(Effect.orDie)
      })

    const completeProfileConnect = (
      userId: string,
      code: string,
      state: string
    ): Effect.Effect<PersonalFigma, FigmaAuthInvalid | FigmaError> =>
      Effect.gen(function* () {
        const oauth = yield* client
        const uri = yield* redirectUri
        yield* consumeState(userId, state)
        const now = yield* DateTime.nowAsDate
        const grant = yield* exchangeAuthorizationCode({
          client: oauth,
          redirectUri: uri,
          code,
          now
        })
        const identity = yield* figma
          .getMe({ _tag: "Bearer", token: grant.accessToken })
          .pipe(
            Effect.catchTags({
              FigmaRateLimited: () =>
                Effect.fail(new FigmaError({ reason: "figma_rate_limited" })),
              FigmaFileNotFound: () =>
                Effect.fail(
                  new FigmaError({ reason: "figma_identity_unavailable" })
                )
            })
          )
        const access = yield* sealToken(grant.accessToken)
        const refresh = yield* sealToken(grant.refreshToken)
        const encrypted = {
          encryptedAccessToken: access.ciphertext,
          accessTokenNonce: access.nonce,
          accessTokenTag: access.tag,
          encryptedRefreshToken: refresh.ciphertext,
          refreshTokenNonce: refresh.nonce,
          refreshTokenTag: refresh.tag
        }
        yield* db
          .insert(userFigmaIntegration)
          .values({
            userId,
            ...encrypted,
            expiresAt: grant.expiresAt,
            figmaUserId: identity.id,
            handle: identity.handle,
            email: identity.email,
            connectedAt: now,
            updatedAt: now,
            lastVerifiedAt: now,
            lastCheckStatus: "ok",
            lastCheckError: null
          })
          .onConflictDoUpdate({
            target: userFigmaIntegration.userId,
            set: {
              ...encrypted,
              expiresAt: grant.expiresAt,
              figmaUserId: identity.id,
              handle: identity.handle,
              email: identity.email,
              updatedAt: now,
              lastVerifiedAt: now,
              lastCheckStatus: "ok",
              lastCheckError: null
            }
          })
          .pipe(Effect.orDie)
        return yield* getProfile(userId)
      })

    const disconnectProfile = (userId: string) =>
      db
        .delete(userFigmaIntegration)
        .where(eq(userFigmaIntegration.userId, userId))
        .pipe(Effect.orDie, Effect.zipRight(getProfile(userId)))

    const projectRow = (orgSlug: string, slug: string) =>
      ticketIndex.projectFor(orgSlug, slug)

    const requireMember = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        const project = yield* projectRow(orgSlug, slug)
        const explicit = yield* db.query.projectMember
          .findFirst({
            columns: { role: true },
            where: and(
              eq(projectMember.projectSlug, slug),
              eq(projectMember.userId, userId)
            )
          })
          .pipe(Effect.orDie)
        if (explicit) return explicit.role
        const orgRole = yield* db.query.member
          .findFirst({
            columns: { role: true },
            where: and(
              eq(orgMember.organizationId, project.organizationId),
              eq(orgMember.userId, userId)
            )
          })
          .pipe(Effect.orDie)
        if (orgRole?.role === "owner" || orgRole?.role === "admin") {
          return "admin" as const
        }
        return yield* new NotFound()
      })

    const requireAdmin = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        const role = yield* requireMember(orgSlug, userId, slug)
        if (role !== "owner" && role !== "admin") {
          return yield* new Forbidden()
        }
      })

    const activeLink = (projectId: string) =>
      db
        .select({
          linkId: projectIntegrationLink.id,
          organizationId: projectIntegrationLink.organizationId,
          connectedAt: projectIntegrationLink.connectedAt,
          status: projectIntegrationLink.status,
          encryptedAccessToken: projectFigmaIntegration.encryptedAccessToken,
          accessTokenNonce: projectFigmaIntegration.accessTokenNonce,
          accessTokenTag: projectFigmaIntegration.accessTokenTag,
          handle: projectFigmaIntegration.handle,
          lastCheckStatus: projectFigmaIntegration.lastCheckStatus,
          lastCheckError: projectFigmaIntegration.lastCheckError
        })
        .from(projectIntegrationLink)
        .innerJoin(
          projectFigmaIntegration,
          eq(
            projectFigmaIntegration.projectIntegrationLinkId,
            projectIntegrationLink.id
          )
        )
        .where(
          and(
            eq(projectIntegrationLink.projectId, projectId),
            eq(projectIntegrationLink.provider, "figma"),
            inArray(projectIntegrationLink.status, ["active", "broken"])
          )
        )
        .orderBy(
          projectIntegrationLink.status,
          desc(projectIntegrationLink.updatedAt)
        )
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0] ?? null)
        )

    const storageConnected = (orgSlug: string) =>
      orgStorage.requireConnection(orgSlug).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false))
      )

    const getProjectStatus = (
      orgSlug: string,
      userId: string,
      slug: string
    ): Effect.Effect<FigmaProjectIntegrationStatus, NotFound> =>
      Effect.gen(function* () {
        yield* requireMember(orgSlug, userId, slug)
        const project = yield* projectRow(orgSlug, slug)
        const row = yield* activeLink(project.projectId)
        const storage = yield* storageConnected(orgSlug)
        if (row === null) return notConnectedStatus(storage)
        return {
          connected: row.status === "active",
          handle: row.handle,
          connectedAt: DateTime.unsafeFromDate(row.connectedAt),
          lastCheckStatus: row.lastCheckStatus,
          lastCheckError: row.lastCheckError,
          storageConnected: storage
        }
      })

    const ensureOrgIntegration = (organizationId: string, now: Date) =>
      Effect.gen(function* () {
        const existing = yield* db.query.organizationIntegration
          .findFirst({
            columns: { id: true },
            where: and(
              eq(organizationIntegration.organizationId, organizationId),
              eq(organizationIntegration.provider, "figma"),
              eq(organizationIntegration.status, "active")
            )
          })
          .pipe(Effect.orDie)
        if (existing) return existing.id
        const [created] = yield* db
          .insert(organizationIntegration)
          .values({
            organizationId,
            provider: "figma",
            status: "active",
            lastCheckedAt: now,
            lastCheckStatus: "ok"
          })
          .returning({ id: organizationIntegration.id })
          .pipe(Effect.orDie)
        return created.id
      })

    const connectProject = (
      orgSlug: string,
      userId: string,
      slug: string,
      accessToken: string
    ) =>
      Effect.gen(function* () {
        yield* requireAdmin(orgSlug, userId, slug)
        yield* orgStorage
          .requireConnection(orgSlug)
          .pipe(Effect.mapError(() => new StorageNotConnected()))
        const identity = yield* figma
          .getMe({ _tag: "FigmaToken", token: accessToken })
          .pipe(
            Effect.catchTag("FigmaFileNotFound", () =>
              Effect.fail(
                new FigmaError({ reason: "figma_identity_unavailable" })
              )
            )
          )
        const project = yield* projectRow(orgSlug, slug)
        const sealed = yield* sealToken(accessToken)
        const now = yield* DateTime.nowAsDate
        const existing = yield* activeLink(project.projectId)
        const stored = {
          encryptedAccessToken: sealed.ciphertext,
          accessTokenNonce: sealed.nonce,
          accessTokenTag: sealed.tag,
          handle: identity.handle,
          lastCheckedAt: now,
          lastCheckStatus: "ok" as const,
          lastCheckError: null
        }
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              if (existing !== null) {
                yield* db
                  .update(projectIntegrationLink)
                  .set({
                    status: "active",
                    lastCheckedAt: now,
                    lastCheckStatus: "ok",
                    lastCheckError: null,
                    updatedAt: now
                  })
                  .where(eq(projectIntegrationLink.id, existing.linkId))
                  .pipe(Effect.orDie)
                yield* db
                  .update(projectFigmaIntegration)
                  .set({ status: "active", ...stored })
                  .where(
                    eq(
                      projectFigmaIntegration.projectIntegrationLinkId,
                      existing.linkId
                    )
                  )
                  .pipe(Effect.orDie)
                return
              }
              const organizationIntegrationId = yield* ensureOrgIntegration(
                project.organizationId,
                now
              )
              const [link] = yield* db
                .insert(projectIntegrationLink)
                .values({
                  projectId: project.projectId,
                  organizationId: project.organizationId,
                  organizationIntegrationId,
                  provider: "figma",
                  status: "active",
                  connectedAt: now,
                  lastCheckedAt: now,
                  lastCheckStatus: "ok",
                  updatedAt: now
                })
                .returning({ id: projectIntegrationLink.id })
                .pipe(Effect.orDie)
              yield* db
                .insert(projectFigmaIntegration)
                .values({
                  projectIntegrationLinkId: link.id,
                  organizationId: project.organizationId,
                  status: "active",
                  ...stored
                })
                .pipe(Effect.orDie)
            })
          )
          .pipe(
            Effect.catchTag("SqlError", () =>
              Effect.fail(
                new FigmaError({ reason: "figma_link_persistence_failed" })
              )
            )
          )
        return yield* getProjectStatus(orgSlug, userId, slug)
      })

    const disconnectProject = (orgSlug: string, userId: string, slug: string) =>
      Effect.gen(function* () {
        yield* requireAdmin(orgSlug, userId, slug)
        const project = yield* projectRow(orgSlug, slug)
        const link = yield* activeLink(project.projectId)
        if (link !== null) {
          const now = yield* DateTime.nowAsDate
          yield* db
            .update(projectIntegrationLink)
            .set({
              status: "disconnected",
              disconnectedAt: now,
              updatedAt: now
            })
            .where(eq(projectIntegrationLink.id, link.linkId))
            .pipe(Effect.orDie)
          yield* db
            .update(projectFigmaIntegration)
            .set({ status: "disconnected" })
            .where(
              eq(projectFigmaIntegration.projectIntegrationLinkId, link.linkId)
            )
            .pipe(Effect.orDie)
        }
        return yield* getProjectStatus(orgSlug, userId, slug)
      })

    const personalCredential = (userId: string) =>
      Effect.gen(function* () {
        const row = yield* db.query.userFigmaIntegration
          .findFirst({
            where: eq(userFigmaIntegration.userId, userId)
          })
          .pipe(Effect.orDie)
        if (!row) return null
        const accessToken = yield* openToken({
          ciphertext: row.encryptedAccessToken,
          nonce: row.accessTokenNonce,
          tag: row.accessTokenTag
        })
        const refreshToken = yield* openToken({
          ciphertext: row.encryptedRefreshToken,
          nonce: row.refreshTokenNonce,
          tag: row.refreshTokenTag
        })
        return {
          accessToken,
          refreshToken,
          expiresAt: row.expiresAt
        } satisfies PersonalCredential
      })

    const projectToken = (orgSlug: string, slug: string) =>
      Effect.gen(function* () {
        const project = yield* projectRow(orgSlug, slug).pipe(
          Effect.catchTag("NotFound", () => Effect.succeed(null))
        )
        if (project === null) return null
        const link = yield* activeLink(project.projectId)
        if (link === null || link.status !== "active") return null
        return yield* openToken({
          ciphertext: link.encryptedAccessToken,
          nonce: link.accessTokenNonce,
          tag: link.accessTokenTag
        })
      })

    const credentialFor = (
      orgSlug: string,
      slug: string,
      userId: string | null
    ): Effect.Effect<
      FigmaCredential,
      FigmaNotConnected | FigmaAuthInvalid | FigmaError
    > =>
      Effect.gen(function* () {
        const personal =
          userId === null ? null : yield* personalCredential(userId)
        const project = yield* projectToken(orgSlug, slug)
        const now = yield* DateTime.nowAsDate
        return yield* resolveCredential({
          personal,
          projectToken: project,
          now,
          refresh: (refreshToken) =>
            Effect.flatMap(client, (oauth) =>
              refreshAccessToken({ client: oauth, refreshToken, now })
            ),
          persist: (grant) =>
            userId === null
              ? Effect.void
              : persistPersonalGrant(userId, grant, now),
          onGrantRejected:
            userId === null
              ? Effect.void
              : markPersonalBroken(userId, "figma_refresh_rejected")
        })
      })

    return {
      getProfile,
      beginProfileConnect,
      completeProfileConnect,
      disconnectProfile,
      getProjectStatus,
      connectProject,
      disconnectProject,
      credentialFor
    } satisfies FigmaIntegrationsShape
  })
)

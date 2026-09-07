import * as Config from "effect/Config"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { and, eq, inArray } from "drizzle-orm"
import { randomBytes, createHash } from "node:crypto"
import {
  Forbidden,
  GitHubError,
  NotFound,
  type GithubOrgIntegrationStatus,
  type Slug
} from "@projectproject/shared"
import {
  githubAppInstallSession,
  organizationGithubIntegration,
  organizationIntegration,
  projectIntegrationLink
} from "../db/schema"
import { CurrentOrg } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import { GitHub } from "../Services/GitHub"
import {
  GitHubIntegrations,
  type GitHubIntegrationsShape
} from "../Services/GitHubIntegrations"

const hashState = (state: string) =>
  createHash("sha256").update(state).digest("hex")

const configError = new GitHubError({
  message: "missing GitHub App configuration"
})

const publicBaseUrl = Config.string("BETTER_AUTH_URL").pipe(
  Config.withDefault("http://localhost:5173")
)

const githubAuthorizeUrl = (
  state: string
): Effect.Effect<string, GitHubError> =>
  Effect.gen(function* () {
    const clientId = yield* Config.string("GITHUB_APP_CLIENT_ID")
    const url = new URL("https://github.com/login/oauth/authorize")
    url.searchParams.set("client_id", clientId)
    url.searchParams.set("state", state)
    return url.toString()
  }).pipe(Effect.mapError(() => configError))

const githubInstallUrl = (state: string): Effect.Effect<string, GitHubError> =>
  Effect.gen(function* () {
    const raw = yield* Config.string("GITHUB_APP_INSTALL_URL")
    const url = new URL(raw)
    url.searchParams.set("state", state)
    return url.toString()
  }).pipe(Effect.mapError(() => configError))

export const GitHubIntegrationsLive = Layer.effect(
  GitHubIntegrations,
  Effect.gen(function* () {
    const db = yield* Db
    const sql = yield* SqlClient.SqlClient
    const currentOrg = yield* CurrentOrg
    const github = yield* GitHub

    const requireOrgOwner = (orgSlug: string, userId: string) =>
      Effect.gen(function* () {
        const org = yield* currentOrg.resolve(orgSlug, userId)
        if (org.role !== "owner") return yield* new Forbidden()
        return org
      })

    const connectedOrgGithub = (organizationId: string) =>
      db
        .select({
          integrationId: organizationIntegration.id,
          status: organizationIntegration.status,
          lastCheckedAt: organizationIntegration.lastCheckedAt,
          lastCheckError: organizationIntegration.lastCheckError,
          installationId: organizationGithubIntegration.installationId,
          accountLogin: organizationGithubIntegration.githubAccountLogin,
          accountType: organizationGithubIntegration.githubAccountType
        })
        .from(organizationIntegration)
        .innerJoin(
          organizationGithubIntegration,
          eq(
            organizationGithubIntegration.organizationIntegrationId,
            organizationIntegration.id
          )
        )
        .where(
          and(
            eq(organizationIntegration.organizationId, organizationId),
            eq(organizationIntegration.provider, "github"),
            inArray(organizationIntegration.status, ["active", "broken"])
          )
        )
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows[0] ?? null)
        )

    const getStatus = (
      orgSlug: string,
      userId: string
    ): Effect.Effect<GithubOrgIntegrationStatus, NotFound> =>
      Effect.gen(function* () {
        const org = yield* currentOrg.resolve(orgSlug, userId)
        const row = yield* connectedOrgGithub(org.organizationId)
        if (!row) {
          return {
            status: "not_connected",
            accountLogin: null,
            accountType: null,
            lastCheckedAt: null,
            lastCheckError: null
          }
        }
        return {
          status: row.status === "active" ? "active" : "broken",
          accountLogin: row.accountLogin,
          accountType: row.accountType,
          lastCheckedAt: row.lastCheckedAt,
          lastCheckError: row.lastCheckError
        }
      })

    const startInstall = (
      orgSlug: string,
      userId: string,
      returnProjectSlug: Slug | null | undefined
    ): Effect.Effect<
      { installUrl: string },
      NotFound | Forbidden | GitHubError
    > =>
      Effect.gen(function* () {
        const org = yield* requireOrgOwner(orgSlug, userId)
        const returnProject =
          returnProjectSlug == null
            ? null
            : yield* db.query.projectIndex
                .findFirst({
                  columns: { id: true, organizationId: true },
                  where: {
                    RAW: (table, _operators) =>
                      _operators.and(
                        _operators.eq(table.organizationId, org.organizationId),
                        _operators.eq(table.slug, returnProjectSlug)
                      )!
                  }
                })
                .pipe(Effect.orDie)
        if (returnProjectSlug != null && !returnProject) {
          return yield* new NotFound()
        }

        const state = yield* Effect.sync(() =>
          randomBytes(32).toString("base64url")
        )
        const now = yield* DateTime.now
        const expiresAt = DateTime.toDate(DateTime.add(now, { minutes: 10 }))
        yield* db
          .insert(githubAppInstallSession)
          .values({
            organizationId: org.organizationId,
            userId,
            returnProjectId: returnProject?.id ?? null,
            returnProjectOrgId: returnProject?.organizationId ?? null,
            stateHash: hashState(state),
            expiresAt
          })
          .pipe(Effect.orDie)

        return { installUrl: yield* githubInstallUrl(state) }
      })

    const sessionForState = (state: string) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate
        const session = yield* db.query.githubAppInstallSession
          .findFirst({
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.stateHash, hashState(state))!
            }
          })
          .pipe(Effect.orDie)
        if (!session || session.completedAt || session.expiresAt < now) {
          return yield* new NotFound()
        }
        return session
      })

    const completeSetup = (
      state: string,
      installationId: string
    ): Effect.Effect<{ authorizeUrl: string }, NotFound | GitHubError> =>
      Effect.gen(function* () {
        const session = yield* sessionForState(state)
        yield* db
          .update(githubAppInstallSession)
          .set({ installationId })
          .where(eq(githubAppInstallSession.id, session.id))
          .pipe(Effect.orDie)
        return { authorizeUrl: yield* githubAuthorizeUrl(state) }
      })

    const completeCallback = (
      state: string,
      code: string
    ): Effect.Effect<
      { redirectUrl: string },
      NotFound | Forbidden | GitHubError
    > =>
      Effect.gen(function* () {
        const session = yield* sessionForState(state)
        if (!session.installationId) return yield* new NotFound()
        const userToken = yield* github.exchangeAppUserCode(code)
        const canAccess = yield* github.appUserCanAccessInstallation(
          userToken,
          session.installationId
        )
        if (!canAccess) return yield* new Forbidden()
        const account = yield* github
          .getInstallationAccount(session.installationId)
          .pipe(
            Effect.catchTag("RepoGone", () =>
              Effect.fail(
                new GitHubError({ message: "installation not found" })
              )
            )
          )
        const now = yield* DateTime.nowAsDate

        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const previousGithubIntegrations = yield* db
                .select({ id: organizationIntegration.id })
                .from(organizationIntegration)
                .innerJoin(
                  organizationGithubIntegration,
                  eq(
                    organizationGithubIntegration.organizationIntegrationId,
                    organizationIntegration.id
                  )
                )
                .where(
                  and(
                    eq(
                      organizationIntegration.organizationId,
                      session.organizationId
                    ),
                    eq(organizationIntegration.provider, "github")
                  )
                )
                .pipe(Effect.orDie)
              const previousIntegrationIds = previousGithubIntegrations.map(
                (integration) => integration.id
              )

              yield* db
                .update(organizationIntegration)
                .set({
                  status: "disconnected",
                  disconnectedAt: now,
                  updatedAt: now
                })
                .where(
                  and(
                    eq(
                      organizationIntegration.organizationId,
                      session.organizationId
                    ),
                    eq(organizationIntegration.provider, "github"),
                    inArray(organizationIntegration.status, [
                      "active",
                      "broken"
                    ])
                  )
                )
                .pipe(Effect.orDie)

              yield* previousIntegrationIds.length === 0
                ? Effect.void
                : db
                    .delete(organizationGithubIntegration)
                    .where(
                      inArray(
                        organizationGithubIntegration.organizationIntegrationId,
                        previousIntegrationIds
                      )
                    )
                    .pipe(Effect.orDie)

              const [created] = yield* db
                .insert(organizationIntegration)
                .values({
                  organizationId: session.organizationId,
                  provider: "github",
                  status: "active",
                  lastCheckedAt: now,
                  lastCheckStatus: "ok"
                })
                .returning()
                .pipe(Effect.orDie)

              yield* db
                .insert(organizationGithubIntegration)
                .values({
                  organizationIntegrationId: created.id,
                  installationId: account.installationId,
                  githubAccountId: account.accountId,
                  githubAccountLogin: account.accountLogin,
                  githubAccountType: account.accountType
                })
                .pipe(Effect.orDie)

              yield* previousIntegrationIds.length === 0
                ? Effect.void
                : db
                    .update(projectIntegrationLink)
                    .set({
                      organizationIntegrationId: created.id,
                      updatedAt: now
                    })
                    .where(
                      and(
                        eq(
                          projectIntegrationLink.organizationId,
                          session.organizationId
                        ),
                        eq(projectIntegrationLink.provider, "github"),
                        inArray(projectIntegrationLink.status, [
                          "active",
                          "broken"
                        ]),
                        inArray(
                          projectIntegrationLink.organizationIntegrationId,
                          previousIntegrationIds
                        )
                      )
                    )
                    .pipe(Effect.orDie)

              yield* db
                .update(githubAppInstallSession)
                .set({ completedAt: now })
                .where(eq(githubAppInstallSession.id, session.id))
                .pipe(Effect.orDie)
            })
          )
          .pipe(Effect.catchTag("SqlError", Effect.die))

        const org = yield* db.query.organization
          .findFirst({
            columns: { slug: true },
            where: {
              RAW: (table, _operators) =>
                _operators.eq(table.id, session.organizationId)!
            }
          })
          .pipe(Effect.orDie)
        if (!org) return yield* new NotFound()
        const project =
          session.returnProjectId == null
            ? null
            : yield* db.query.projectIndex
                .findFirst({
                  columns: { slug: true },
                  where: {
                    RAW: (table, _operators) =>
                      _operators.and(
                        _operators.eq(table.id, session.returnProjectId!),
                        _operators.eq(
                          table.organizationId,
                          session.organizationId
                        )
                      )!
                  }
                })
                .pipe(Effect.orDie)
        const baseUrl = yield* publicBaseUrl.pipe(
          Effect.mapError(() => configError)
        )
        const redirectUrl = project
          ? `${baseUrl}/orgs/${org.slug}/projects/${project.slug}?githubInstall=success`
          : `${baseUrl}/orgs/${org.slug}?githubInstall=success`
        return { redirectUrl }
      })

    const listRepos = (
      orgSlug: string,
      userId: string,
      query: string | undefined,
      page: number
    ) =>
      Effect.gen(function* () {
        const org = yield* requireOrgOwner(orgSlug, userId)
        const integration = yield* connectedOrgGithub(org.organizationId)
        if (!integration || integration.status !== "active") {
          return yield* new NotFound()
        }
        return yield* github.listInstallationRepos(
          integration.installationId,
          query,
          page
        )
      })

    return {
      getStatus,
      startInstall,
      completeSetup,
      completeCallback,
      listRepos
    } satisfies GitHubIntegrationsShape
  })
)

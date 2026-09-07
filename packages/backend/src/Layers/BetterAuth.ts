import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { drizzle } from "drizzle-orm/node-postgres"
import { and, eq } from "drizzle-orm"
import { auth } from "../auth"
import * as schema from "../db/schema"
import {
  account,
  member,
  organization,
  userEverhourIntegration
} from "../db/schema"
import {
  NotFound,
  paginateSorted,
  type CursorPayload,
  type Org,
  type OrgRole
} from "@projectproject/shared"
import {
  BetterAuth,
  BetterAuthError,
  NoGithubToken,
  type BetterAuthShape
} from "../Services/BetterAuth"

export const BetterAuthLive = Layer.effect(
  BetterAuth,
  Effect.sync(() => {
    const db = drizzle(process.env.DATABASE_URL!, { schema })

    return {
      handler: (request) =>
        Effect.tryPromise({
          try: () => auth.handler(request),
          catch: (cause) => new BetterAuthError({ cause })
        }),
      getSession: (headers) =>
        Effect.tryPromise({
          try: () => auth.api.getSession({ headers }),
          catch: (cause) => new BetterAuthError({ cause })
        }),
      getGithubAccessToken: (userId) =>
        Effect.gen(function* () {
          const row = yield* Effect.tryPromise({
            try: () =>
              db.query.account.findFirst({
                columns: { accessToken: true },
                where: and(
                  eq(account.userId, userId),
                  eq(account.providerId, "github")
                )
              }),
            catch: (cause) => new BetterAuthError({ cause })
          })
          if (!row?.accessToken) return yield* new NoGithubToken()
          return row.accessToken
        }),
      getPersonalGithub: (userId) =>
        Effect.gen(function* () {
          const row = yield* Effect.tryPromise({
            try: () =>
              db.query.account.findFirst({
                columns: { id: true },
                where: and(
                  eq(account.userId, userId),
                  eq(account.providerId, "github")
                )
              }),
            catch: (cause) => new BetterAuthError({ cause })
          })
          return {
            connected: row !== undefined
          }
        }),
      getPersonalEverhour: (userId) =>
        Effect.gen(function* () {
          const row = yield* Effect.tryPromise({
            try: () =>
              db.query.userEverhourIntegration.findFirst({
                columns: {
                  everhourUserId: true,
                  name: true,
                  email: true,
                  lastVerifiedAt: true,
                  lastCheckError: true
                },
                where: eq(userEverhourIntegration.userId, userId)
              }),
            catch: (cause) => new BetterAuthError({ cause })
          })
          return {
            connected: row !== undefined,
            everhourUserId: row?.everhourUserId ?? null,
            name: row?.name ?? null,
            email: row?.email ?? null,
            lastVerifiedAt: row?.lastVerifiedAt ?? null,
            lastCheckError: row?.lastCheckError ?? null
          }
        }),
      listOrganizations: (userId) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({ slug: organization.slug, role: member.role })
                .from(member)
                .innerJoin(
                  organization,
                  eq(member.organizationId, organization.id)
                )
                .where(eq(member.userId, userId)),
            catch: (cause) => new BetterAuthError({ cause })
          })
          // `member.role` is a free-form text column in Better Auth's schema;
          // we coerce to the three-tier literal and drop anything unexpected.
          const allowed = new Set(["owner", "admin", "member"] as const)
          return rows.flatMap((r) =>
            allowed.has(r.role as "owner" | "admin" | "member")
              ? [
                  {
                    orgSlug: r.slug,
                    role: r.role as "owner" | "admin" | "member"
                  }
                ]
              : []
          )
        }),
      listOrganizationsPaged: (
        userId: string,
        cursor: CursorPayload | undefined,
        limit: number
      ) =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  slug: organization.slug,
                  name: organization.name,
                  role: member.role
                })
                .from(member)
                .innerJoin(
                  organization,
                  eq(member.organizationId, organization.id)
                )
                .where(eq(member.userId, userId)),
            catch: (cause) => new BetterAuthError({ cause })
          })
          const allowed = new Set(["owner", "admin", "member"] as const)
          const orgs: ReadonlyArray<Org> = rows.flatMap((r) =>
            allowed.has(r.role as OrgRole)
              ? [
                  {
                    slug: r.slug as Org["slug"],
                    name: r.name,
                    role: r.role as OrgRole
                  }
                ]
              : []
          )
          const sorted = [...orgs].toSorted(
            (a, b) =>
              a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)
          )
          return paginateSorted(sorted, {
            cursor,
            limit,
            sortKey: (o) => o.name,
            id: (o) => o.slug
          })
        }),
      getOrganization: (userId: string, orgSlug: string) =>
        Effect.gen(function* () {
          const row = yield* Effect.tryPromise({
            try: () =>
              db
                .select({
                  slug: organization.slug,
                  name: organization.name,
                  role: member.role
                })
                .from(member)
                .innerJoin(
                  organization,
                  eq(member.organizationId, organization.id)
                )
                .where(
                  and(eq(member.userId, userId), eq(organization.slug, orgSlug))
                )
                .limit(1),
            catch: (cause) => new BetterAuthError({ cause })
          })
          const first = row[0]
          if (!first) return yield* new NotFound()
          const allowed = new Set(["owner", "admin", "member"] as const)
          if (!allowed.has(first.role as OrgRole)) return yield* new NotFound()
          return {
            slug: first.slug as Org["slug"],
            name: first.name,
            role: first.role as OrgRole
          }
        }),
      getOrgSlugById: (organizationId) =>
        Effect.gen(function* () {
          if (!organizationId) return null
          const row = yield* Effect.tryPromise({
            try: () =>
              db.query.organization.findFirst({
                columns: { slug: true },
                where: eq(organization.id, organizationId)
              }),
            catch: (cause) => new BetterAuthError({ cause })
          })
          return row?.slug ?? null
        }),
      submitConsent: (headers, input) =>
        Effect.tryPromise({
          try: async () => {
            const result = await auth.api.oauth2Consent({
              body: input,
              headers
            })
            return { redirectURI: result.url }
          },
          catch: (cause) => new BetterAuthError({ cause })
        })
    } satisfies BetterAuthShape
  })
)

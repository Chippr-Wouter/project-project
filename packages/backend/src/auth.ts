import { betterAuth } from "better-auth"
import { admin, jwt, magicLink, organization } from "better-auth/plugins"
import { mcp } from "@better-auth/mcp"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { APIError } from "better-auth/api"
import { drizzle } from "drizzle-orm/node-postgres"
import { and, eq, inArray, sql } from "drizzle-orm"
import { FileSystem, Path } from "effect"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import matter from "gray-matter"
import * as schema from "./db/schema"
import * as authSchema from "./db/auth-schema"
import {
  projectIndex,
  projectInviteGrant,
  projectMember,
  user
} from "./db/schema"

const db = drizzle(process.env.DATABASE_URL!, { relations: schema.relations })

const SAFE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/
const TICKET_FILE = /^T-[1-9][0-9]*\.md$/

function roleList(role: string): ReadonlyArray<string> {
  return role.split(",").map((r) => r.trim())
}

export function lastOrgOwnerBlocked(input: {
  nextRole: string | null
  targetRole: string | null
  otherOwnerCount: number
}): boolean {
  if (input.nextRole !== null && roleList(input.nextRole).includes("owner")) {
    return false
  }
  if (
    input.targetRole === null ||
    !roleList(input.targetRole).includes("owner")
  ) {
    return false
  }
  return input.otherOwnerCount === 0
}

export function projectOwnerRemovalError(
  projectSlugs: ReadonlyArray<string>
): APIError | undefined {
  if (projectSlugs.length === 0) return undefined
  return new APIError(409, {
    code: "PROJECT_OWNER_REMOVAL_BLOCKED",
    message: "Transfer project ownership before removing this member",
    projectSlugs: [...projectSlugs]
  })
}

async function assertNotLastOrgOwner(
  organizationId: string,
  targetUserId: string,
  nextRole: string | null
) {
  if (nextRole !== null && roleList(nextRole).includes("owner")) return
  const target = await db.query.member.findFirst({
    columns: { role: true },
    where: { organizationId: organizationId, userId: targetUserId }
  })
  if (!target || !roleList(target.role).includes("owner")) return
  const others = await db.query.member.findMany({
    columns: { id: true },
    where: {
      organizationId: organizationId,
      role: "owner",
      userId: { ne: targetUserId }
    }
  })
  if (
    lastOrgOwnerBlocked({
      nextRole,
      targetRole: target.role,
      otherOwnerCount: others.length
    })
  ) {
    throw new APIError("BAD_REQUEST", {
      code: "LAST_ORG_OWNER_BLOCKED",
      message: "Cannot remove or demote the last organization owner"
    })
  }
}

async function projectOwnerSlugs(organizationId: string, userId: string) {
  return db
    .select({ slug: projectIndex.slug })
    .from(projectIndex)
    .innerJoin(
      projectMember,
      and(
        eq(projectMember.projectSlug, projectIndex.slug),
        eq(projectMember.userId, userId),
        eq(projectMember.role, "owner")
      )
    )
    .where(eq(projectIndex.organizationId, organizationId))
}

function projectsRoot() {
  const root = process.env.PROJECTS_DIR
  if (!root) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      code: "PROJECTS_DIR_MISSING",
      message: "PROJECTS_DIR is not configured"
    })
  }
  return root
}

async function unassignUserFromActiveTicketsOnDisk(
  orgSlug: string,
  projectSlug: string,
  userId: string
) {
  if (!SAFE_SLUG.test(orgSlug) || !SAFE_SLUG.test(projectSlug)) return
  await Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = projectsRoot()
      const absoluteRoot = path.isAbsolute(root)
        ? root
        : path.resolve(process.cwd(), root)
      const ticketsDir = path.join(
        absoluteRoot,
        "orgs",
        orgSlug,
        "projects",
        projectSlug,
        "tickets"
      )
      const exists = yield* fs.exists(ticketsDir)
      if (!exists) return
      const files = yield* fs.readDirectory(ticketsDir)
      yield* Effect.forEach(
        files.filter((file) => TICKET_FILE.test(file)),
        (file) =>
          Effect.gen(function* () {
            const filePath = path.join(ticketsDir, file)
            const raw = yield* fs.readFileString(filePath, "utf8")
            const parsed = matter(raw)
            const assignees = Array.isArray(parsed.data.assignees)
              ? parsed.data.assignees
              : typeof parsed.data.assignee === "string"
                ? [parsed.data.assignee]
                : []
            if (
              parsed.data.status === "done" ||
              !assignees.some((id) => id === userId)
            ) {
              return
            }
            parsed.data.assignees = assignees.filter((id) => id !== userId)
            parsed.data.updatedAt = DateTime.toDate(
              DateTime.nowUnsafe()
            ).toISOString()
            yield* fs.writeFileString(
              filePath,
              matter.stringify(parsed.content, parsed.data)
            )
          }),
        { concurrency: 8 }
      )
    }).pipe(Effect.provide(BunServices.layer))
  )
}

async function cleanupRemovedOrgMemberProjectAccess(
  orgSlug: string,
  organizationId: string,
  userId: string
) {
  const rows = await db
    .select({ slug: projectIndex.slug })
    .from(projectIndex)
    .innerJoin(
      projectMember,
      and(
        eq(projectMember.projectSlug, projectIndex.slug),
        eq(projectMember.userId, userId)
      )
    )
    .where(eq(projectIndex.organizationId, organizationId))
  const slugs = rows.map((row) => row.slug)
  await Promise.all(
    slugs.map((slug) =>
      unassignUserFromActiveTicketsOnDisk(orgSlug, slug, userId)
    )
  )
  if (slugs.length === 0) return
  await db
    .delete(projectMember)
    .where(
      and(
        eq(projectMember.userId, userId),
        inArray(projectMember.projectSlug, slugs)
      )
    )
}

// TODO: configure and export `auth`.
export const mcpResource = new URL(
  "/mcp",
  process.env.MCP_RESOURCE_URL ??
    process.env.BETTER_AUTH_URL ??
    "http://localhost:3000"
).href

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: ["http://localhost:5173", "http://localhost:3000"],
  // `username` is a human-readable handle used in markdown frontmatter and
  // the members UI. Better Auth's CLI doesn't know about it from the schema
  // alone — declaring it here lets `auth.api.updateUser` etc. round-trip
  // the field.
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: false,
        input: false,
        unique: true
      },
      editorPreference: {
        type: "string",
        required: false,
        input: true
      }
    }
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github", "google"],
      allowDifferentEmails: true
    }
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      scope: ["repo", "read:org"],
      disableSignUp: true
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET
    }
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60
    }
  },
  // On sign-in, return the user to the org they were last in. We persist
  // that on `user.lastActiveOrganizationId` (a column on the user table)
  // and capture it at sign-out time via the `session.delete.before` hook.
  // First-ever sign-in falls back to the user's first org membership.
  // Subsequent in-app org changes flow through the switcher (T-08) — never
  // via URL navigation.
  databaseHooks: {
    session: {
      create: {
        before: async (sessionData) => {
          const currentUser = await db.query.user.findFirst({
            columns: { lastActiveOrganizationId: true },
            where: { id: sessionData.userId }
          })
          let orgId = currentUser?.lastActiveOrganizationId ?? null
          if (orgId) {
            const stillMember = await db.query.member.findFirst({
              columns: { organizationId: true },
              where: { userId: sessionData.userId, organizationId: orgId }
            })
            if (!stillMember) orgId = null
          }
          if (!orgId) {
            const firstMembership = await db.query.member.findFirst({
              columns: { organizationId: true },
              where: { userId: sessionData.userId }
            })
            orgId = firstMembership?.organizationId ?? null
          }
          if (!orgId) return { data: sessionData }
          return {
            data: { ...sessionData, activeOrganizationId: orgId }
          }
        }
      },
      delete: {
        before: async (sessionData) => {
          const orgId = (
            sessionData as { activeOrganizationId?: string | null }
          ).activeOrganizationId
          if (!orgId) return
          await db
            .update(user)
            .set({ lastActiveOrganizationId: orgId })
            .where(eq(user.id, sessionData.userId))
        }
      }
    }
  },
  plugins: [
    organization({
      requireEmailVerificationOnInvitation: true,
      allowUserToCreateOrganization: false,
      schema: {
        organization: {
          additionalFields: {
            billingCustomerId: {
              type: "string",
              required: false,
              input: false
            },
            subscriptionStatus: {
              type: "string",
              required: false,
              input: false
            },
            deletedAt: { type: "date", required: false, input: false }
          }
        }
      },
      sendInvitationEmail: async (data) => {
        const acceptUrl = `${process.env.BETTER_AUTH_URL}/invite/${data.invitation.id}`
        process.stdout.write(
          `[invitation] org=${data.organization.slug} email=${data.email} role=${data.role} url=${acceptUrl}\n`
        )
      },
      organizationHooks: {
        beforeRemoveMember: async ({ member }) => {
          await assertNotLastOrgOwner(
            member.organizationId,
            member.userId,
            null
          )
          const owned = await projectOwnerSlugs(
            member.organizationId,
            member.userId
          )
          const blocked = projectOwnerRemovalError(
            owned.map((project) => project.slug)
          )
          if (blocked) throw blocked
        },
        afterRemoveMember: async ({ member, organization }) => {
          await cleanupRemovedOrgMemberProjectAccess(
            organization.slug,
            member.organizationId,
            member.userId
          )
        },
        beforeUpdateMemberRole: async ({ member, newRole }) => {
          await assertNotLastOrgOwner(
            member.organizationId,
            member.userId,
            newRole
          )
        },
        afterAcceptInvitation: async ({ invitation, user }) => {
          await db.transaction(async (tx) => {
            const grants = await tx
              .select({
                projectSlug: projectInviteGrant.projectSlug,
                projectId: projectInviteGrant.projectId,
                role: projectInviteGrant.role
              })
              .from(projectInviteGrant)
              .innerJoin(
                projectIndex,
                and(
                  eq(projectIndex.slug, projectInviteGrant.projectSlug),
                  eq(projectIndex.id, projectInviteGrant.projectId)
                )
              )
              .where(eq(projectInviteGrant.invitationId, invitation.id))

            if (grants.length > 0) {
              await tx
                .insert(projectMember)
                .values(
                  grants.map((grant) => ({
                    projectSlug: grant.projectSlug,
                    projectId: grant.projectId,
                    userId: user.id,
                    role: grant.role
                  }))
                )
                .onConflictDoNothing({
                  target: [projectMember.projectSlug, projectMember.userId]
                })
            }

            await tx
              .delete(projectInviteGrant)
              .where(eq(projectInviteGrant.invitationId, invitation.id))
          })
        },
        afterRejectInvitation: async ({ invitation }) => {
          await db
            .delete(projectInviteGrant)
            .where(eq(projectInviteGrant.invitationId, invitation.id))
        },
        afterCancelInvitation: async ({ invitation }) => {
          await db
            .delete(projectInviteGrant)
            .where(eq(projectInviteGrant.invitationId, invitation.id))
        }
      }
    }),
    magicLink({
      sendMagicLink: async (data) => {
        process.stdout.write(
          `[magic-link] email=${data.email} url=${data.url}\n`
        )
      }
    }),
    admin(),
    jwt(),
    mcp({
      loginPage: "/login",
      resource: mcpResource,
      consentPage: "/oauth/consent",
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      refreshTokenReuseInterval: 0,
      extensions: [
        {
          claims: {
            accessToken: async ({ user, client }) => ({
              pp_consent_ids: user
                ? (
                    await db
                      .select({ id: authSchema.oauthConsent.id })
                      .from(authSchema.oauthConsent)
                      .where(
                        and(
                          eq(authSchema.oauthConsent.userId, user.id),
                          eq(authSchema.oauthConsent.clientId, client.clientId)
                        )
                      )
                  ).map((consent) => consent.id)
                : []
            })
          }
        }
      ]
    }),
    {
      id: "legacy-mcp-resources",
      init: async () => {
        await db.execute(sql`
          INSERT INTO oauth_client_resource (id, client_id, resource_id, created_at)
          SELECT gen_random_uuid()::text, client.client_id, ${mcpResource}, now()
          FROM oauth_client AS client
          INNER JOIN oauth_application AS legacy
            ON legacy.id = client.id AND legacy.client_id = client.client_id
          ON CONFLICT (client_id, resource_id) DO NOTHING
        `)
      }
    }
  ]
})

export type User = (typeof auth.$Infer.Session)["user"]
export type Session = (typeof auth.$Infer.Session)["session"]

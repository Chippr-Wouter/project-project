import { APIError } from "better-auth/api"
import { getTestInstance } from "better-auth/test"
import { magicLinkClient, organizationClient } from "better-auth/client/plugins"
import { organization } from "better-auth/plugins"
import * as DateTime from "effect/DateTime"
import { describe, expect, it, vi } from "vite-plus/test"

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({ query: {} }))
}))

vi.mock("better-auth", async () => {
  const actual =
    await vi.importActual<typeof import("better-auth")>("better-auth")
  return {
    ...actual,
    betterAuth: vi.fn((options: Record<string, unknown>) => ({
      options,
      api: new Proxy({}, { get: () => vi.fn() }),
      handler: vi.fn()
    }))
  }
})

import { auth, lastOrgOwnerBlocked, projectOwnerRemovalError } from "./auth"

describe("Better Auth plugin wiring", () => {
  it("signs users in through a magic link and marks the email verified", async () => {
    const magicLinkPlugin = configuredPlugin("magic-link")
    const writes: Array<string> = []
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk))
        return true
      })

    try {
      const { client, customFetchImpl, db } = await getTestInstance(
        { plugins: [magicLinkPlugin] },
        {
          disableTestUser: true,
          clientOptions: { plugins: [magicLinkClient()] }
        }
      )

      const { data, error } = await client.signIn.magicLink({
        email: "invited@example.com",
        callbackURL: "/"
      })

      expect(error).toBeNull()
      expect(data?.status).toBe(true)

      const verificationUrl = writes.join("").match(/url=(?<url>\S+)/)
        ?.groups?.url
      expect(verificationUrl).toBeDefined()
      expect(verificationUrl).toContain("/magic-link/verify")

      const response = await customFetchImpl(verificationUrl!, {
        redirect: "manual"
      })
      expect(response.status).toBeGreaterThanOrEqual(300)
      expect(response.status).toBeLessThan(400)

      const user = await db.findOne<{ emailVerified: boolean }>({
        model: "user",
        where: [{ field: "email", value: "invited@example.com" }],
        select: ["emailVerified"]
      })
      expect(user?.emailVerified).toBe(true)
    } finally {
      writeSpy.mockRestore()
    }
  })

  it("rejects invite acceptance when the signed-in recipient email is not verified", async () => {
    const organizationPlugin = testOrganizationPlugin()
    const { client, signInWithTestUser, signInWithUser } =
      await getTestInstance(
        {
          plugins: [organizationPlugin],
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: false
          }
        },
        { clientOptions: { plugins: [organizationClient()] } }
      )

    const owner = await signInWithTestUser()
    let invitationId: string | undefined

    await owner.runWithUser(async () => {
      const { data: organization, error: createError } =
        await client.organization.create({
          name: "Demo",
          slug: "demo"
        })
      expect(createError).toBeNull()

      const { data: invitation, error: inviteError } =
        await client.organization.inviteMember({
          email: "invited@example.com",
          role: "member",
          organizationId: organization!.id
        })
      expect(inviteError).toBeNull()
      invitationId = invitation!.id
    })

    const { error: signUpError } = await client.signUp.email({
      email: "invited@example.com",
      password: "password123",
      name: "Invited User"
    })
    expect(signUpError).toBeNull()

    const invited = await signInWithUser("invited@example.com", "password123")
    const { error } = await client.organization.acceptInvitation({
      invitationId: invitationId!,
      fetchOptions: { headers: invited.headers }
    })

    expect(error?.message).toBe(
      "Email verification required before accepting or rejecting invitation"
    )
  })

  it("lists, rejects, and accepts organization invitations through the client", async () => {
    const organizationPlugin = testOrganizationPlugin()
    const { client, signInWithTestUser, signInWithUser, db } =
      await getTestInstance(
        {
          plugins: [organizationPlugin],
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: false
          }
        },
        { clientOptions: { plugins: [organizationClient()] } }
      )

    const owner = await signInWithTestUser()
    const invitationIds: string[] = []
    const organizationIds: string[] = []

    await owner.runWithUser(async () => {
      for (const slug of ["demo-a", "demo-b"]) {
        const { data: organization, error: createError } =
          await client.organization.create({
            name: slug,
            slug
          })
        expect(createError).toBeNull()
        organizationIds.push(organization!.id)

        const { data: invitation, error: inviteError } =
          await client.organization.inviteMember({
            email: "flow@example.com",
            role: "member",
            organizationId: organization!.id
          })
        expect(inviteError).toBeNull()
        invitationIds.push(invitation!.id)
      }
    })

    await client.signUp.email({
      email: "flow@example.com",
      password: "password123",
      name: "Flow User"
    })
    await db.update({
      model: "user",
      where: [{ field: "email", value: "flow@example.com" }],
      update: { emailVerified: true }
    })

    const invited = await signInWithUser("flow@example.com", "password123")
    const { data: listed, error: listError } =
      await client.organization.listUserInvitations({
        fetchOptions: { headers: invited.headers }
      })
    expect(listError).toBeNull()
    expect(listed?.map((invite) => invite.id).sort()).toEqual(
      invitationIds.toSorted()
    )

    const { error: rejectError } = await client.organization.rejectInvitation({
      invitationId: invitationIds[0],
      fetchOptions: { headers: invited.headers }
    })
    expect(rejectError).toBeNull()

    const rejected = await db.findOne<{ status: string }>({
      model: "invitation",
      where: [{ field: "id", value: invitationIds[0] }],
      select: ["status"]
    })
    expect(rejected?.status).toBe("rejected")

    const { error: acceptError } = await client.organization.acceptInvitation({
      invitationId: invitationIds[1],
      fetchOptions: { headers: invited.headers }
    })
    expect(acceptError).toBeNull()

    const invitedUser = await db.findOne<{ id: string }>({
      model: "user",
      where: [{ field: "email", value: "flow@example.com" }],
      select: ["id"]
    })
    const membership = await db.findOne<{ organizationId: string }>({
      model: "member",
      where: [
        { field: "organizationId", value: organizationIds[1] },
        { field: "userId", value: invitedUser!.id }
      ],
      select: ["organizationId"]
    })
    expect(membership?.organizationId).toBe(organizationIds[1])
  })

  it("exposes the organization plugin endpoints", () => {
    expect(typeof auth.api.createOrganization).toBe("function")
    expect(typeof auth.api.listOrganizations).toBe("function")
    expect(typeof auth.api.createInvitation).toBe("function")
    expect(typeof auth.api.acceptInvitation).toBe("function")
    expect(typeof auth.api.setActiveOrganization).toBe("function")
  })

  it("disables public self-serve organization creation", () => {
    const orgPlugin = auth.options.plugins?.find(
      (plugin) => plugin.id === "organization"
    )
    expect(orgPlugin?.options?.allowUserToCreateOrganization).toBe(false)
    expect(orgPlugin?.options?.requireEmailVerificationOnInvitation).toBe(true)
  })

  it("allows GitHub account linking for users with a different profile email", () => {
    expect(auth.options.account?.accountLinking?.enabled).toBe(true)
    expect(auth.options.account?.accountLinking?.trustedProviders).toContain(
      "github"
    )
    expect(auth.options.account?.accountLinking?.allowDifferentEmails).toBe(
      true
    )
  })

  it("requests GitHub repository and organization membership scopes", () => {
    expect(auth.options.socialProviders?.github?.scope).toEqual([
      "repo",
      "read:org"
    ])
  })

  it("exposes the admin plugin endpoints", () => {
    expect(typeof auth.api.listUsers).toBe("function")
    expect(typeof auth.api.setRole).toBe("function")
    expect(typeof auth.api.banUser).toBe("function")
    expect(typeof auth.api.impersonateUser).toBe("function")
  })
})

describe("organization owner guard invariants", () => {
  it("blocks demoting the last remaining owner", () => {
    expect(
      lastOrgOwnerBlocked({
        nextRole: "admin",
        targetRole: "owner",
        otherOwnerCount: 0
      })
    ).toBe(true)
  })

  it("blocks removing the last remaining owner", () => {
    expect(
      lastOrgOwnerBlocked({
        nextRole: null,
        targetRole: "owner",
        otherOwnerCount: 0
      })
    ).toBe(true)
  })

  it("allows demoting an owner when another owner remains", () => {
    expect(
      lastOrgOwnerBlocked({
        nextRole: "admin",
        targetRole: "owner",
        otherOwnerCount: 1
      })
    ).toBe(false)
  })

  it("never blocks a promotion to owner", () => {
    expect(
      lastOrgOwnerBlocked({
        nextRole: "owner",
        targetRole: "member",
        otherOwnerCount: 0
      })
    ).toBe(false)
  })

  it("ignores non-owner targets", () => {
    expect(
      lastOrgOwnerBlocked({
        nextRole: "member",
        targetRole: "admin",
        otherOwnerCount: 0
      })
    ).toBe(false)
  })

  it("permits the transfer order (promote target, then demote self)", () => {
    const promoteTarget = lastOrgOwnerBlocked({
      nextRole: "owner",
      targetRole: "member",
      otherOwnerCount: 1
    })
    const demoteSelf = lastOrgOwnerBlocked({
      nextRole: "admin",
      targetRole: "owner",
      otherOwnerCount: 1
    })
    expect(promoteTarget).toBe(false)
    expect(demoteSelf).toBe(false)
  })

  it("blocks the reverse transfer order (demote self while sole owner)", () => {
    expect(
      lastOrgOwnerBlocked({
        nextRole: "admin",
        targetRole: "owner",
        otherOwnerCount: 0
      })
    ).toBe(true)
  })
})

describe("project-owner removal guard", () => {
  it("does not block when the member owns no projects", () => {
    expect(projectOwnerRemovalError([])).toBeUndefined()
  })

  it("blocks with a 409 and the owned project slugs", () => {
    const error = projectOwnerRemovalError(["alpha", "beta"])
    expect(error).toBeInstanceOf(APIError)
    expect(error?.statusCode).toBe(409)
    expect(error?.body?.code).toBe("PROJECT_OWNER_REMOVAL_BLOCKED")
    expect(
      (error?.body as { projectSlugs?: ReadonlyArray<string> })?.projectSlugs
    ).toEqual(["alpha", "beta"])
  })
})

describe("organization role assignment access control", () => {
  it("lets an owner assign owner and blocks admins, and enforces last-owner order", async () => {
    const { client, signInWithTestUser, signInWithUser, db } =
      await getTestInstance(
        {
          plugins: [testOrganizationPlugin()],
          emailAndPassword: {
            enabled: true,
            requireEmailVerification: false
          }
        },
        { clientOptions: { plugins: [organizationClient()] } }
      )

    const owner = await signInWithTestUser()
    let organizationId = ""
    let ownerMemberId = ""

    await owner.runWithUser(async () => {
      const { data, error } = await client.organization.create({
        name: "Acme",
        slug: "acme"
      })
      expect(error).toBeNull()
      organizationId = data!.id
    })

    const ownerMember = await db.findOne<{ id: string }>({
      model: "member",
      where: [
        { field: "organizationId", value: organizationId },
        { field: "userId", value: owner.user.id }
      ],
      select: ["id"]
    })
    ownerMemberId = ownerMember!.id

    await client.signUp.email({
      email: "admin@example.com",
      password: "password123",
      name: "Admin User"
    })
    const adminUser = await db.findOne<{ id: string }>({
      model: "user",
      where: [{ field: "email", value: "admin@example.com" }],
      select: ["id"]
    })
    await db.create({
      model: "member",
      data: {
        organizationId,
        userId: adminUser!.id,
        role: "admin",
        createdAt: DateTime.toDate(DateTime.nowUnsafe())
      }
    })

    await client.signUp.email({
      email: "target@example.com",
      password: "password123",
      name: "Target User"
    })
    const targetUser = await db.findOne<{ id: string }>({
      model: "user",
      where: [{ field: "email", value: "target@example.com" }],
      select: ["id"]
    })
    const targetMember = await db.create<
      Record<string, unknown>,
      { id: string }
    >({
      model: "member",
      data: {
        organizationId,
        userId: targetUser!.id,
        role: "member",
        createdAt: DateTime.toDate(DateTime.nowUnsafe())
      }
    })

    const soleOwnerDemote = await client.organization.updateMemberRole({
      organizationId,
      memberId: ownerMemberId,
      role: "admin",
      fetchOptions: { headers: owner.headers }
    })
    expect(soleOwnerDemote.error).not.toBeNull()

    const admin = await signInWithUser("admin@example.com", "password123")
    const adminPromote = await client.organization.updateMemberRole({
      organizationId,
      memberId: targetMember.id,
      role: "owner",
      fetchOptions: { headers: admin.headers }
    })
    expect(adminPromote.error?.status).toBe(403)

    const ownerPromote = await client.organization.updateMemberRole({
      organizationId,
      memberId: targetMember.id,
      role: "owner",
      fetchOptions: { headers: owner.headers }
    })
    expect(ownerPromote.error).toBeNull()
    expect(ownerPromote.data?.role).toContain("owner")

    const selfDemote = await client.organization.updateMemberRole({
      organizationId,
      memberId: ownerMemberId,
      role: "admin",
      fetchOptions: { headers: owner.headers }
    })
    expect(selfDemote.error).toBeNull()
    expect(selfDemote.data?.role).toBe("admin")
  })
})

function configuredPlugin(id: string) {
  const plugin = auth.options.plugins?.find((plugin) => plugin.id === id)
  if (!plugin) throw new Error(`Missing Better Auth plugin: ${id}`)
  return plugin
}

function testOrganizationPlugin() {
  return organization({
    requireEmailVerificationOnInvitation: true,
    allowUserToCreateOrganization: true
  })
}

import { describe, expect, it } from "vite-plus/test"
import * as Effect from "effect/Effect"
import { bootstrapOrg, type BootstrapOrgStore } from "./org"

type Org = { id: string; slug: string; name: string }
type User = { id: string; email: string; name: string; username: string | null }
type Member = {
  id: string
  organizationId: string
  userId: string
  role: string
}

const input = {
  orgSlug: "project-project",
  orgName: "ProjectProject",
  ownerEmail: "owner@example.com",
  ownerName: "Owner Example",
  ownerUsername: "owner"
}

function makeStore() {
  const orgs = new Map<string, Org>()
  const users = new Map<string, User>()
  const members: Member[] = []
  let next = 1

  const store: BootstrapOrgStore = {
    findOrgBySlug: (slug) => Effect.sync(() => orgs.get(slug) ?? null),
    createOrg: ({ slug, name }) =>
      Effect.sync(() => {
        const org = { id: `org-${next++}`, slug, name }
        orgs.set(slug, org)
        return org
      }),
    findUserByEmail: (email) =>
      Effect.sync(
        () => [...users.values()].find((u) => u.email === email) ?? null
      ),
    createUser: ({ email, name, username }) =>
      Effect.sync(() => {
        const user = { id: `user-${next++}`, email, name, username }
        users.set(user.id, user)
        return user
      }),
    findMember: ({ organizationId, userId }) =>
      Effect.sync(
        () =>
          members.find(
            (m) => m.organizationId === organizationId && m.userId === userId
          ) ?? null
      ),
    createMember: ({ organizationId, userId, role }) =>
      Effect.sync(() => {
        const member = { id: `member-${next++}`, organizationId, userId, role }
        members.push(member)
        return member
      }),
    updateMemberRole: ({ memberId, role }) =>
      Effect.sync(() => {
        const member = members.find((m) => m.id === memberId)
        if (member) member.role = role
      }),
    setUserLastActiveOrg: () => Effect.void
  }

  return { store, orgs, users, members }
}

function runBootstrap(store: BootstrapOrgStore) {
  return Effect.runPromise(bootstrapOrg(store, input))
}

describe("bootstrapOrg", () => {
  it("creates the configured org and first owner identity", async () => {
    const { store, orgs, users, members } = makeStore()

    const result = await runBootstrap(store)

    expect(result).toEqual({
      org: { id: "org-1", slug: "project-project", name: "ProjectProject" },
      owner: {
        id: "user-2",
        email: "owner@example.com",
        name: "Owner Example",
        username: "owner"
      },
      membership: {
        id: "member-3",
        organizationId: "org-1",
        userId: "user-2",
        role: "owner"
      },
      created: { org: true, owner: true, membership: true }
    })
    expect(orgs.size).toBe(1)
    expect(users.size).toBe(1)
    expect(members).toHaveLength(1)
  })

  it("reuses existing org, owner, and membership on repeat runs", async () => {
    const { store, members } = makeStore()

    await runBootstrap(store)
    const second = await runBootstrap(store)

    expect(second.created).toEqual({
      org: false,
      owner: false,
      membership: false
    })
    expect(members).toHaveLength(1)
  })

  it("promotes an existing owner membership to owner", async () => {
    const { store, members } = makeStore()
    await runBootstrap(store)
    members[0].role = "member"

    const result = await runBootstrap(store)

    expect(result.membership.role).toBe("owner")
    expect(members).toHaveLength(1)
  })
})

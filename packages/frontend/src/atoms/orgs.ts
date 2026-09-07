import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import { authClient } from "@/services/AuthClient"
import type { AssignableRole, OrgDetail, OrgRole } from "@projectproject/shared"
import { authData, meAtom } from "./auth"

export const orgKey = (orgSlug: string) => orgSlug

export const orgMemberKey = (orgSlug: string, memberId: string) =>
  `${orgSlug}/${memberId}`

export const orgInvitationKey = (orgSlug: string, invitationId: string) =>
  `${orgSlug}/${invitationId}`

const splitOrgSubKey = (key: string) => {
  const separator = key.indexOf("/")
  return {
    orgSlug: key.slice(0, separator),
    id: key.slice(separator + 1)
  }
}

export type OrgMember = {
  id: string
  userId: string
  role: OrgRole
  name: string
  email: string
  image: string | null
}

export type OrgInvitation = {
  id: string
  email: string
  role: OrgRole
}

export type OrgMembers = {
  members: ReadonlyArray<OrgMember>
  invitations: ReadonlyArray<OrgInvitation>
}

const toOrgRole = (role: string): OrgRole => {
  const roles = role.split(",")
  if (roles.includes("owner")) return "owner"
  if (roles.includes("admin")) return "admin"
  return "member"
}

export const userOrgsAtom = runtime
  .atom(
    Effect.gen(function* () {
      const client = yield* ApiClient
      return yield* client.org.myOrgs()
    })
  )
  .pipe(Atom.setIdleTTL("1 minute"))

const orgDetailBaseAtom = Atom.family((orgSlug: string) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.org.get({ params: { orgSlug } })
      })
    )
    .pipe(Atom.setIdleTTL("2 minutes"))
)

export const orgDetailAtom = Atom.family((orgSlug: string) =>
  Atom.optimistic(orgDetailBaseAtom(orgSlug))
)

export const renameOrgAtom = Atom.family((orgSlug: string) =>
  Atom.optimisticFn(orgDetailAtom(orgSlug), {
    reducer: (current, input: { name: string }) =>
      Result.isSuccess(current)
        ? Result.success(
            { ...current.value, name: input.name },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: { name: string }, get) {
        const current = get(orgDetailBaseAtom(orgSlug))
        if (!Result.isSuccess(current)) {
          return yield* Effect.die(new Error("org detail not loaded"))
        }
        yield* Effect.tryPromise(() =>
          authData(
            authClient.organization.update({
              data: { name: input.name },
              organizationId: current.value.id
            })
          )
        )
        get.refresh(orgDetailBaseAtom(orgSlug))
        get.refresh(userOrgsAtom)
        get.refresh(meAtom)
      })
    )
  })
)

export const softDeleteOrgAtom = Atom.family((orgSlug: string) =>
  runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const client = yield* ApiClient
      const detail = yield* client.org.softDelete({ params: { orgSlug } })
      get.refresh(orgDetailBaseAtom(orgSlug))
      get.refresh(userOrgsAtom)
      get.refresh(meAtom)
      return detail
    })
  )
)

export const restoreOrgAtom = Atom.family((orgSlug: string) =>
  runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const client = yield* ApiClient
      const detail = yield* client.org.restore({ params: { orgSlug } })
      get.refresh(orgDetailBaseAtom(orgSlug))
      get.refresh(userOrgsAtom)
      get.refresh(meAtom)
      return detail
    })
  )
)

const orgMembersBaseAtom = Atom.family((orgSlug: string) =>
  runtime
    .atom(
      Effect.tryPromise(async (): Promise<OrgMembers> => {
        const full = await authData(
          authClient.organization.getFullOrganization({
            query: { organizationSlug: orgSlug }
          })
        )
        const members = (full?.members ?? []).map((member): OrgMember => ({
          id: member.id,
          userId: member.userId,
          role: toOrgRole(member.role),
          name: member.user?.name ?? member.user?.email ?? "",
          email: member.user?.email ?? "",
          image: member.user?.image ?? null
        }))
        const invitations = (full?.invitations ?? [])
          .filter((invitation) => invitation.status === "pending")
          .map((invitation): OrgInvitation => ({
            id: invitation.id,
            email: invitation.email,
            role: toOrgRole(invitation.role)
          }))
        return { members, invitations }
      })
    )
    .pipe(Atom.setIdleTTL("30 seconds"))
)

export const orgMembersAtom = Atom.family((orgSlug: string) =>
  Atom.optimistic(orgMembersBaseAtom(orgSlug))
)

export const inviteOrgMemberAtom = Atom.family((orgSlug: string) =>
  Atom.optimisticFn(orgMembersAtom(orgSlug), {
    reducer: (current, _input: { email: string; role: AssignableRole }) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (
        input: { email: string; role: AssignableRole },
        get
      ) {
        const detail = get(orgDetailBaseAtom(orgSlug))
        if (!Result.isSuccess(detail)) {
          return yield* Effect.die(new Error("org detail not loaded"))
        }
        const organizationId = detail.value.id
        yield* Effect.tryPromise(() =>
          authData(
            authClient.organization.inviteMember({
              email: input.email,
              role: input.role,
              organizationId
            })
          )
        )
        get.refresh(orgMembersBaseAtom(orgSlug))
      })
    )
  })
)

export const updateOrgMemberRoleAtom = Atom.family((memberKey: string) => {
  const { orgSlug, id: memberId } = splitOrgSubKey(memberKey)
  return Atom.optimisticFn(orgMembersAtom(orgSlug), {
    reducer: (current, input: { role: AssignableRole }) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              ...current.value,
              members: current.value.members.map((member) =>
                member.id === memberId
                  ? { ...member, role: input.role }
                  : member
              )
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: { role: AssignableRole }, get) {
        const detail = get(orgDetailBaseAtom(orgSlug))
        if (!Result.isSuccess(detail)) {
          return yield* Effect.die(new Error("org detail not loaded"))
        }
        const organizationId = detail.value.id
        yield* Effect.tryPromise(() =>
          authData(
            authClient.organization.updateMemberRole({
              role: input.role,
              memberId,
              organizationId
            })
          )
        )
        get.refresh(orgMembersBaseAtom(orgSlug))
      })
    )
  })
})

export const removeOrgMemberAtom = Atom.family((memberKey: string) => {
  const { orgSlug, id: memberId } = splitOrgSubKey(memberKey)
  return Atom.optimisticFn(orgMembersAtom(orgSlug), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              ...current.value,
              members: current.value.members.filter(
                (member) => member.id !== memberId
              )
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const detail = get(
          orgDetailBaseAtom(orgSlug)
        ) as Result.AsyncResult<OrgDetail>
        if (!Result.isSuccess(detail)) {
          return yield* Effect.die(new Error("org detail not loaded"))
        }
        const organizationId = detail.value.id
        yield* Effect.tryPromise(() =>
          authData(
            authClient.organization.removeMember({
              memberIdOrEmail: memberId,
              organizationId
            })
          )
        )
        get.refresh(orgMembersBaseAtom(orgSlug))
      })
    )
  })
})

export const cancelOrgInvitationAtom = Atom.family((invitationKey: string) => {
  const { orgSlug, id: invitationId } = splitOrgSubKey(invitationKey)
  return Atom.optimisticFn(orgMembersAtom(orgSlug), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              ...current.value,
              invitations: current.value.invitations.filter(
                (invitation) => invitation.id !== invitationId
              )
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        yield* Effect.tryPromise(() =>
          authData(authClient.organization.cancelInvitation({ invitationId }))
        )
        get.refresh(orgMembersBaseAtom(orgSlug))
      })
    )
  })
})

export const leaveOrgAtom = Atom.family((orgSlug: string) =>
  runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const detail = get(
        orgDetailBaseAtom(orgSlug)
      ) as Result.AsyncResult<OrgDetail>
      if (!Result.isSuccess(detail)) {
        return yield* Effect.die(new Error("org detail not loaded"))
      }
      const organizationId = detail.value.id
      yield* Effect.tryPromise(() =>
        authData(authClient.organization.leave({ organizationId }))
      )
      get.refresh(meAtom)
      get.refresh(userOrgsAtom)
    })
  )
)

export const transferOrgOwnershipAtom = Atom.family((orgSlug: string) =>
  Atom.optimisticFn(orgMembersAtom(orgSlug), {
    reducer: (current, input: { toMemberId: string; selfMemberId: string }) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              ...current.value,
              members: current.value.members.map((member) => {
                if (member.id === input.toMemberId) {
                  return { ...member, role: "owner" as OrgRole }
                }
                if (member.id === input.selfMemberId) {
                  return { ...member, role: "admin" as OrgRole }
                }
                return member
              })
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (
        input: { toMemberId: string; selfMemberId: string },
        get
      ) {
        const detail = get(orgDetailBaseAtom(orgSlug))
        if (!Result.isSuccess(detail)) {
          return yield* Effect.die(new Error("org detail not loaded"))
        }
        const organizationId = detail.value.id
        yield* Effect.gen(function* () {
          yield* Effect.tryPromise(() =>
            authData(
              authClient.organization.updateMemberRole({
                role: "owner",
                memberId: input.toMemberId,
                organizationId
              })
            )
          )
          yield* Effect.tryPromise(() =>
            authData(
              authClient.organization.updateMemberRole({
                role: "admin",
                memberId: input.selfMemberId,
                organizationId
              })
            )
          )
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              get.refresh(orgMembersBaseAtom(orgSlug))
              get.refresh(orgDetailBaseAtom(orgSlug))
              get.refresh(meAtom)
            })
          )
        )
      })
    )
  })
)

import * as DateTime from "effect/DateTime"

export type RawInvitation = {
  id: string
  email: string
  role: string
  organizationId: string
  organizationName: string
  inviterId: string
  status: string
  expiresAt: Date | string
  createdAt: Date | string
}

export type PendingInvite = RawInvitation & {
  organizationSlug: string
  inviterEmail: string
  expiresAt: Date
  createdAt: Date
}

export type InviteAcceptSuccess = {
  invite: PendingInvite
}

export type InviteAcceptError =
  | { _tag: "InviteExpired"; inviteId: string }
  | { _tag: "InviteNotFound"; inviteId: string }
  | { _tag: "InviteNotRecipient"; inviteId: string }
  | { _tag: "InviteEmailVerificationRequired"; inviteId: string }
  | { _tag: "InviteAcceptFailed"; inviteId: string; cause: unknown }

export type InviteAcceptFailure = {
  invite: PendingInvite
  error: InviteAcceptError
}

export type InviteAcceptResult = {
  successes: InviteAcceptSuccess[]
  failures: InviteAcceptFailure[]
  activeInvite: PendingInvite | null
}

const normalizedEmail = (email: string) => email.trim().toLowerCase()

export const isActionableInvitation = (
  invite: RawInvitation,
  userEmail: string,
  now: Date
) =>
  invite.status === "pending" &&
  normalizedEmail(invite.email) === normalizedEmail(userEmail) &&
  toDate(invite.expiresAt) > now

export const filterActionableInvitations = (
  invites: readonly RawInvitation[],
  userEmail: string,
  now = DateTime.toDate(DateTime.nowUnsafe())
) => invites.filter((invite) => isActionableInvitation(invite, userEmail, now))

export const toPendingInvite = (
  invite: RawInvitation & { organizationSlug: string; inviterEmail: string }
): PendingInvite => ({
  ...invite,
  expiresAt: toDate(invite.expiresAt),
  createdAt: toDate(invite.createdAt)
})

export const pickActiveInvite = (
  invites: readonly PendingInvite[]
): PendingInvite | null => {
  let active: PendingInvite | null = null
  for (const invite of invites) {
    if (!active) {
      active = invite
      continue
    }
    const diff = invite.createdAt.getTime() - active.createdAt.getTime()
    if (
      diff > 0 ||
      (diff === 0 && invite.organizationSlug < active.organizationSlug)
    ) {
      active = invite
    }
  }
  return active
}

export const acceptInvitations = async (
  invites: readonly PendingInvite[],
  accept: (invite: PendingInvite) => Promise<void>,
  now = DateTime.toDate(DateTime.nowUnsafe())
): Promise<InviteAcceptResult> => {
  const settled = await Promise.allSettled(
    invites.map(async (invite) => {
      await accept(invite)
      return invite
    })
  )
  const successes: InviteAcceptSuccess[] = []
  const failures: InviteAcceptFailure[] = []

  settled.forEach((result, index) => {
    const invite = invites[index]
    if (result.status === "fulfilled") {
      successes.push({ invite: result.value })
      return
    }
    failures.push({
      invite,
      error: toInviteAcceptError(invite, result.reason, now)
    })
  })

  return {
    successes,
    failures,
    activeInvite: pickActiveInvite(successes.map((success) => success.invite))
  }
}

const toInviteAcceptError = (
  invite: PendingInvite,
  cause: unknown,
  now: Date
): InviteAcceptError => {
  if (invite.expiresAt <= now) {
    return { _tag: "InviteExpired", inviteId: invite.id }
  }
  if (hasErrorCode(cause, "INVITATION_NOT_FOUND")) {
    return { _tag: "InviteNotFound", inviteId: invite.id }
  }
  if (hasErrorCode(cause, "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION")) {
    return { _tag: "InviteNotRecipient", inviteId: invite.id }
  }
  if (
    hasErrorCode(
      cause,
      "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION"
    )
  ) {
    return { _tag: "InviteEmailVerificationRequired", inviteId: invite.id }
  }
  return { _tag: "InviteAcceptFailed", inviteId: invite.id, cause }
}

export const hasErrorCode = (cause: unknown, code: string) =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === code

const toDate = (value: Date | string) =>
  value instanceof Date ? value : DateTime.toDate(DateTime.makeUnsafe(value))

import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  createFileRoute,
  Link,
  Navigate,
  useNavigate
} from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { LogOut, MailCheck } from "lucide-react"
import { useState } from "react"
import {
  acceptInviteAtom,
  declineInvitationAtom,
  invitationAtom,
  logoutAtom,
  meAtom,
  setActiveOrganizationAtom
} from "@/atoms/auth"
import { ErrorPage } from "@/components/ErrorPage"
import {
  OnboardingGateStatus,
  OnboardingShell
} from "@/components/OnboardingShell"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

import type { PendingInvite } from "@/lib/invitations"

export const Route = createFileRoute("/invite/$invitationId")({
  component: InvitePage
})

function InvitePage() {
  const { invitationId } = Route.useParams()
  const me = useAtomValue(meAtom)

  return Result.matchWithError(me, {
    onInitial: () => (
      <OnboardingGateStatus>{m.chrome_loading()}</OnboardingGateStatus>
    ),
    onError: () => (
      <Navigate
        to="/login"
        search={{ redirect: `/invite/${invitationId}` }}
        replace
      />
    ),
    onDefect: (defect) => <ErrorPage error={defect} />,
    onSuccess: () => <InviteResolver invitationId={invitationId} />
  })
}

function InviteResolver({ invitationId }: { invitationId: string }) {
  const invitation = useAtomValue(invitationAtom(invitationId))

  return Result.matchWithError(invitation, {
    onInitial: () => (
      <OnboardingShell icon={MailCheck}>
        <InviteSkeleton />
      </OnboardingShell>
    ),
    onError: () => (
      <OnboardingShell icon={MailCheck}>
        <InviteUnavailable />
      </OnboardingShell>
    ),
    onDefect: (defect) => <ErrorPage error={defect} />,
    onSuccess: ({ value }) => (
      <OnboardingShell icon={MailCheck}>
        <InviteAccept invite={value} />
      </OnboardingShell>
    )
  })
}

function InviteAccept({ invite }: { invite: PendingInvite }) {
  const navigate = useNavigate()
  const accept = useAtomSet(acceptInviteAtom(invite.id), {
    mode: "promiseExit"
  })
  const acceptState = useAtomValue(acceptInviteAtom(invite.id))
  const decline = useAtomSet(declineInvitationAtom(invite.id), {
    mode: "promiseExit"
  })
  const declineState = useAtomValue(declineInvitationAtom(invite.id))
  const activateOrg = useAtomSet(setActiveOrganizationAtom("me"), {
    mode: "promiseExit"
  })
  const [pending, setPending] = useState<"accept" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)

  const accepting = acceptState.waiting || pending === "accept"
  const declining = declineState.waiting || pending === "decline"
  const busy = accepting || declining

  const onAccept = async () => {
    setError(null)
    setPending("accept")
    try {
      const acceptExit = await accept()
      if (Exit.isFailure(acceptExit)) {
        setError(m.auth_invite_accept_error())
        return
      }
      const activeExit = await activateOrg(invite.organizationSlug)
      if (Exit.isFailure(activeExit)) {
        setError(m.auth_invite_accept_error())
        return
      }
      await navigate({
        to: "/orgs/$orgSlug",
        params: { orgSlug: invite.organizationSlug },
        replace: true
      })
    } finally {
      setPending(null)
    }
  }

  const onDecline = async () => {
    setError(null)
    setPending("decline")
    try {
      const declineExit = await decline()
      if (Exit.isFailure(declineExit)) {
        setError(m.auth_invite_decline_error())
        return
      }
      await navigate({ to: "/welcome", replace: true })
    } finally {
      setPending(null)
    }
  }

  const initial = invite.organizationName.trim().charAt(0).toUpperCase() || "·"

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          {m.auth_invite_title()}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {m.auth_invite_body({ org: invite.organizationName })}
        </p>
      </div>
      <div
        className={cn(
          "flex items-center gap-4 rounded-xl border border-border bg-background px-4 py-4",
          busy && "animate-pulse"
        )}
      >
        <div
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border ring-inset"
        >
          <span className="font-mono text-base font-medium leading-none text-foreground">
            {initial}
          </span>
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
              {invite.organizationName}
            </span>
            <span className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-px text-[10.5px] font-medium capitalize leading-[1.5] text-muted-foreground">
              {roleLabel(invite.role)}
            </span>
          </div>
          <div className="truncate text-[12.5px] leading-5 text-muted-foreground">
            {m.auth_invites_row_detail({ inviter: invite.inviterEmail })}
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          leadingIcon={MailCheck}
          loading={accepting}
          disabled={busy}
          onClick={onAccept}
        >
          {m.auth_invites_accept_button()}
        </Button>
        <Button
          type="button"
          variant="tertiary"
          loading={declining}
          disabled={busy}
          onClick={onDecline}
        >
          {m.auth_invites_decline_button()}
        </Button>
      </div>
    </div>
  )
}

function InviteUnavailable() {
  const logout = useAtomSet(logoutAtom)

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          {m.auth_invite_unavailable_title()}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {m.auth_invite_unavailable_body()}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" render={<Link to="/welcome" />}>
          {m.auth_invite_unavailable_cta()}
        </Button>
        <Button
          type="button"
          variant="tertiary"
          leadingIcon={LogOut}
          onClick={() => logout()}
        >
          {m.auth_welcome_sign_out_button()}
        </Button>
      </div>
    </div>
  )
}

function InviteSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-3/5 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="flex items-center gap-4 rounded-xl border border-border bg-background px-4 py-4">
        <div className="size-11 shrink-0 animate-pulse rounded-md bg-muted" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-56 animate-pulse rounded-md bg-muted" />
        </div>
      </div>
    </div>
  )
}

function roleLabel(role: string) {
  if (role === "owner") return m.auth_invites_role_owner()
  if (role === "admin") return m.auth_invites_role_admin()
  return m.auth_invites_role_member()
}

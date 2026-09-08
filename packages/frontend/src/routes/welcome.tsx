import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { Inbox, LogOut, MailCheck, UserRound } from "lucide-react"
import { useCallback, useContext, useState } from "react"
import {
  acceptInviteAtom,
  declineInvitationAtom,
  logoutAtom,
  meAtom,
  pendingInvitesAtom,
  setActiveOrganizationAtom
} from "@/atoms/auth"
import { Button } from "@/components/ui/button"
import {
  OnboardingGateStatus,
  OnboardingShell
} from "@/components/OnboardingShell"
import { ErrorPage } from "@/components/ErrorPage"
import { errorMessage } from "@/lib/errorMessage"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

import {
  acceptInvitations,
  pickActiveInvite,
  type InviteAcceptFailure,
  type InviteAcceptResult,
  type PendingInvite
} from "@/lib/invitations"

export const Route = createFileRoute("/welcome")({
  component: WelcomePage
})

function WelcomePage() {
  const me = useAtomValue(meAtom)

  return Result.matchWithError(me, {
    onInitial: () => (
      <OnboardingGateStatus>{m.chrome_loading()}</OnboardingGateStatus>
    ),
    onError: () => <Navigate to="/login" replace />,
    onDefect: (defect) => <ErrorPage error={defect} />,
    onSuccess: ({ value }) =>
      value.activeOrgSlug ? (
        <Navigate
          to="/orgs/$orgSlug"
          params={{ orgSlug: value.activeOrgSlug }}
          replace
        />
      ) : (
        <WelcomeContent />
      )
  })
}

function WelcomeContent() {
  const invites = useAtomValue(pendingInvitesAtom)

  return (
    <OnboardingShell icon={Inbox}>
      {Result.match(invites, {
        onInitial: () => <WelcomeSkeleton />,
        onFailure: () => <WelcomeNoAccess />,
        onSuccess: ({ value, waiting }) =>
          value.length > 0 ? (
            <WelcomeInviteList invites={value} syncing={waiting} />
          ) : (
            <WelcomeNoAccess />
          )
      })}
    </OnboardingShell>
  )
}

function WelcomeNoAccess() {
  const logout = useAtomSet(logoutAtom("me"))

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          {m.auth_welcome_title()}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {m.auth_welcome_body()}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          leadingIcon={LogOut}
          onClick={() => logout()}
        >
          {m.auth_welcome_sign_out_button()}
        </Button>
        <Button
          type="button"
          variant="tertiary"
          leadingIcon={UserRound}
          onClick={() => logout()}
        >
          {m.auth_welcome_try_another_account_button()}
        </Button>
      </div>
    </>
  )
}

function WelcomeInviteList({
  invites,
  syncing
}: {
  invites: readonly PendingInvite[]
  syncing: boolean
}) {
  const registry = useContext(RegistryContext)
  const navigate = useNavigate({ from: Route.fullPath })
  const activateOrg = useAtomSet(setActiveOrganizationAtom("me"), {
    mode: "promiseExit"
  })
  const logout = useAtomSet(logoutAtom("me"))
  const [failedAccepts, setFailedAccepts] = useState<InviteAcceptFailure[]>([])
  const [acceptingAll, setAcceptingAll] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const failedById = new Map(
    failedAccepts.map((failure) => [failure.invite.id, failure])
  )

  const clearFailure = useCallback((inviteId: string) => {
    setPageError(null)
    setFailedAccepts((failures) =>
      failures.filter((failure) => failure.invite.id !== inviteId)
    )
  }, [])

  const acceptInvite = useCallback(
    async (invite: PendingInvite): Promise<InviteAcceptResult> => {
      const atom = acceptInviteAtom(invite.id)
      return await acceptInvitations([invite], async () => {
        const unmount = registry.mount(atom)
        try {
          registry.set(atom, undefined)
          const exit = await Effect.runPromiseExit(
            Registry.getResult(registry, atom, { suspendOnWaiting: true })
          )
          if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
        } finally {
          unmount()
        }
      })
    },
    [registry]
  )

  const applyAcceptResults = useCallback(
    async (results: readonly InviteAcceptResult[]) => {
      const failures = results.flatMap((result) => result.failures)
      const successes = results.flatMap((result) => result.successes)
      const activeInvite = pickActiveInvite(
        successes.map((success) => success.invite)
      )

      setFailedAccepts((current) => {
        const failedIds = new Set(failures.map((failure) => failure.invite.id))
        return [
          ...current.filter((failure) => !failedIds.has(failure.invite.id)),
          ...failures
        ]
      })

      if (!activeInvite) return false

      const activeExit = await activateOrg(activeInvite.organizationSlug)
      if (Exit.isFailure(activeExit)) {
        setPageError(m.auth_invites_accept_all_error())
        return false
      }

      await navigate({
        to: "/orgs/$orgSlug",
        params: { orgSlug: activeInvite.organizationSlug },
        replace: true
      })
      return true
    },
    [activateOrg, navigate]
  )

  const onAcceptAll = async () => {
    setPageError(null)
    setFailedAccepts([])
    setAcceptingAll(true)
    const results = await Promise.all(
      invites.map((invite) => acceptInvite(invite))
    )
    setAcceptingAll(false)

    const navigated = await applyAcceptResults(results)
    const failures = results.flatMap((result) => result.failures)
    if (!navigated && failures.length === invites.length) {
      setPageError(m.auth_invites_accept_all_error())
    }
  }

  const onAcceptResult = async (
    invite: PendingInvite,
    result: InviteAcceptResult
  ) => {
    clearFailure(invite.id)
    await applyAcceptResults([result])
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-normal text-foreground">
          {m.auth_invites_title()}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          {m.auth_invites_body()}
        </p>
      </div>
      <ul
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-background",
          syncing && "animate-pulse"
        )}
      >
        {invites.map((invite) => (
          <InviteRow
            key={invite.id}
            invite={invite}
            acceptFailure={failedById.get(invite.id)}
            acceptingAll={acceptingAll}
            clearFailure={clearFailure}
            acceptInvite={acceptInvite}
            onAcceptResult={onAcceptResult}
          />
        ))}
      </ul>
      {pageError ? (
        <p className="text-sm text-destructive">{pageError}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {invites.length > 1 ? (
          <Button
            type="button"
            leadingIcon={MailCheck}
            loading={acceptingAll}
            disabled={acceptingAll}
            onClick={onAcceptAll}
          >
            {m.auth_invites_accept_all_button()}
          </Button>
        ) : null}
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

function InviteRow({
  invite,
  acceptFailure,
  acceptingAll,
  clearFailure,
  acceptInvite,
  onAcceptResult
}: {
  invite: PendingInvite
  acceptFailure: InviteAcceptFailure | undefined
  acceptingAll: boolean
  clearFailure: (inviteId: string) => void
  acceptInvite: (invite: PendingInvite) => Promise<InviteAcceptResult>
  onAcceptResult: (
    invite: PendingInvite,
    result: InviteAcceptResult
  ) => Promise<void>
}) {
  const acceptState = useAtomValue(acceptInviteAtom(invite.id))
  const decline = useAtomSet(declineInvitationAtom(invite.id), {
    mode: "promiseExit"
  })
  const declineState = useAtomValue(declineInvitationAtom(invite.id))
  const accepting = acceptState.waiting
  const declining = declineState.waiting
  const declineFailed = Result.isFailure(declineState)

  const onAccept = async () => {
    clearFailure(invite.id)
    const result = await acceptInvite(invite)
    await onAcceptResult(invite, result)
  }

  const onDecline = async () => {
    await decline()
  }

  const initial = invite.organizationName.trim().charAt(0).toUpperCase() || "·"

  return (
    <li
      className={cn(
        "group flex items-start gap-3 border-border border-b px-4 py-3.5 transition-colors last:border-b-0 hover:bg-muted/30 sm:items-center sm:gap-4",
        (accepting || declining) && "animate-pulse"
      )}
    >
      <div
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted ring-1 ring-border ring-inset"
      >
        <span className="font-mono text-[15px] font-medium leading-none text-foreground">
          {initial}
        </span>
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-[14px] font-medium leading-5 text-foreground">
            {invite.organizationName}
          </span>
          <span className="inline-flex shrink-0 items-center rounded bg-muted px-1.5 py-px text-[10.5px] font-medium capitalize leading-[1.5] text-muted-foreground">
            {roleLabel(invite.role)}
          </span>
        </div>
        <div className="truncate text-[12.5px] leading-5 text-muted-foreground">
          {m.auth_invites_row_detail({ inviter: invite.inviterEmail })}
        </div>
        {acceptFailure ? (
          <div className="pt-1 text-[12.5px] leading-5 text-destructive">
            {errorMessage(acceptFailure.error)}
          </div>
        ) : null}
        {declineFailed ? (
          <div className="pt-1 text-[12.5px] leading-5 text-destructive">
            {m.auth_invites_decline_row_error()}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1 self-center">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={declining || accepting || acceptingAll}
          loading={declining}
          onClick={onDecline}
        >
          {m.auth_invites_decline_button()}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={accepting}
          disabled={declining || accepting || acceptingAll}
          onClick={onAccept}
        >
          {m.auth_invites_accept_button()}
        </Button>
      </div>
    </li>
  )
}

function WelcomeSkeleton() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {[0, 1].map((index) => (
          <div
            key={index}
            className="flex items-center gap-4 border-border border-b px-4 py-3.5 last:border-b-0"
          >
            <div className="size-10 shrink-0 animate-pulse rounded-md bg-muted" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-4 w-40 animate-pulse rounded-md bg-muted" />
              <div className="h-3 w-64 animate-pulse rounded-md bg-muted" />
            </div>
            <div className="flex shrink-0 gap-1.5">
              <div className="h-7 w-16 animate-pulse rounded-md bg-muted" />
              <div className="h-7 w-16 animate-pulse rounded-md bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function roleLabel(role: string) {
  if (role === "owner") return m.auth_invites_role_owner()
  if (role === "admin") return m.auth_invites_role_admin()
  return m.auth_invites_role_member()
}

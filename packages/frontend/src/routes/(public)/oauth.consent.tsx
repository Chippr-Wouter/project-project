import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute, Navigate } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { useState, type ReactNode } from "react"
import { meAtom } from "@/atoms/auth"
import { oauthClientNameAtom, submitConsentAtom } from "@/atoms/oauthConsent"
import { m } from "@/paraglide/messages"
import { Button } from "@/components/ui/button"
import { DitherShell } from "@/components/ui/dither-shell"
import { Logo, Wordmark } from "@/components/Logo"
import { oauthConsentErrorMessage } from "@/lib/errorMessage"
import { rawQueryFromSearch } from "@/lib/oauthQuery"

type Search = {
  client_id?: string
  scope?: string
}

export const Route = createFileRoute("/(public)/oauth/consent")({
  component: OauthConsentPage,
  validateSearch: (raw): Search => ({
    client_id: typeof raw.client_id === "string" ? raw.client_id : undefined,
    scope: typeof raw.scope === "string" ? raw.scope : undefined
  })
})

function OauthConsentPage() {
  const me = useAtomValue(meAtom)
  const search = Route.useSearch()
  const oauthQuery =
    typeof window === "undefined"
      ? ""
      : rawQueryFromSearch(window.location.search)
  const clientId =
    search.client_id ??
    new URLSearchParams(oauthQuery).get("client_id") ??
    undefined

  if (Result.isFailure(me)) {
    return (
      <Navigate
        to="/login"
        search={{ redirect: `/oauth/consent?${oauthQuery}` }}
      />
    )
  }

  if (!oauthQuery) {
    return <ConsentShell title={m.auth_oauth_consent_title()} />
  }

  return <ConsentForm oauthQuery={oauthQuery} clientId={clientId} />
}

function ConsentForm({
  oauthQuery,
  clientId
}: {
  oauthQuery: string
  clientId: string | undefined
}) {
  const submit = useAtomSet(submitConsentAtom(oauthQuery), {
    mode: "promiseExit"
  })
  const submitState = useAtomValue(submitConsentAtom(oauthQuery))
  const clientName = useAtomValue(oauthClientNameAtom(clientId ?? ""))
  const displayName =
    (Result.isSuccess(clientName) ? clientName.value : null) ??
    m.auth_oauth_consent_client_fallback()
  const [pending, setPending] = useState<"accept" | "deny" | null>(null)
  const error = Result.matchWithError(submitState, {
    onInitial: () => null,
    onSuccess: () => null,
    onError: oauthConsentErrorMessage,
    onDefect: oauthConsentErrorMessage
  })

  const onSubmit = async (accept: boolean) => {
    setPending(accept ? "accept" : "deny")
    const exit = await submit({ accept, oauthQuery })
    if (Exit.isSuccess(exit)) {
      window.location.replace(exit.value.redirectURI)
      return
    }
    setPending(null)
  }

  const capabilities = [
    m.auth_oauth_consent_capability_read(),
    m.auth_oauth_consent_capability_write_tickets(),
    m.auth_oauth_consent_capability_write_comments(),
    m.auth_oauth_consent_capability_attach_branch()
  ]

  return (
    <ConsentShell title={m.auth_oauth_consent_title()}>
      <p className="text-center text-sm text-muted-foreground wrap-anywhere">
        {m.auth_oauth_consent_subtitle({ client: displayName })}
      </p>
      <div className="flex w-full flex-col gap-2">
        <p className="text-sm font-medium text-foreground">
          {m.auth_oauth_consent_capabilities_heading()}
        </p>
        <ul className="w-full space-y-1.5 rounded-xl bg-background/60 p-3 text-[13px] text-foreground">
          {capabilities.map((label) => (
            <li key={label} className="flex items-start gap-2">
              <span aria-hidden className="mt-[5px] text-muted-foreground">
                ·
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex w-full flex-col gap-2">
        <Button
          onClick={() => onSubmit(true)}
          disabled={pending !== null}
          size="lg"
          className="w-full"
        >
          {pending === "accept"
            ? m.auth_oauth_consent_accept_pending()
            : m.auth_oauth_consent_accept_button()}
        </Button>
        <Button
          variant="tertiary"
          onClick={() => onSubmit(false)}
          disabled={pending !== null}
          size="lg"
          className="w-full"
        >
          {pending === "deny"
            ? m.auth_oauth_consent_deny_pending()
            : m.auth_oauth_consent_deny_button()}
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="text-center text-xs leading-relaxed text-destructive"
        >
          {error}
        </p>
      ) : (
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
          {m.auth_oauth_consent_footnote()}
        </p>
      )}
    </ConsentShell>
  )
}

function ConsentShell({
  title,
  children
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <DitherShell>
      <div className="relative flex flex-col items-center gap-4 px-8 pb-2 pt-10 text-foreground">
        <div className="relative flex size-16 items-center justify-center rounded-2xl corner-squircle bg-primary">
          <Logo className="size-10" inverted />
        </div>
        <Wordmark className="h-5 w-auto" />
      </div>
      <div className="relative flex flex-col items-center gap-5 px-8 pb-8 pt-6">
        <h1 className="text-base font-medium text-foreground">{title}</h1>
        {children}
      </div>
    </DitherShell>
  )
}

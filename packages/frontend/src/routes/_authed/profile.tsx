import * as Result from "effect/unstable/reactivity/AsyncResult"
import { type FormEvent, useEffect, useRef, useState } from "react"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import {
  type EditorPreference,
  FigmaAuthInvalid,
  FigmaError
} from "@projectproject/shared"
import {
  connectPersonalGithubAtom,
  disconnectPersonalGithubAtom,
  meAtom,
  updateEditorPreferenceAtom
} from "@/atoms/auth"
import {
  connectEverhourProfileAtom,
  disconnectEverhourProfileAtom
} from "@/atoms/everhour"
import githubLogo from "@/assets/github.svg"
import { errorMessage } from "@/lib/errorMessage"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"
import { SEGMENTED_ITEM_CLASS, SegmentedTabs } from "@/components/SegmentedTabs"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { ConfirmButton, useConfirmButton } from "@/components/ui/confirm-button"
import { Input } from "@/components/ui/input"
import { ConnectedAgentsSection } from "@/components/ConnectedAgentsSection"
import { FigmaProfileSettings } from "@/components/settings/FigmaProfileSettings"
import { MemberAvatar } from "@/components/MemberAvatar"
import { PageContainer, PageHeader } from "@/components/page"

const ProfileSearch = Schema.Struct({
  error: Schema.optional(Schema.NonEmptyString),
  figmaError: Schema.optional(Schema.NonEmptyString)
})
const decodeProfileSearch = Schema.decodeUnknownOption(ProfileSearch)
type ProfileSearch = Schema.Schema.Type<typeof ProfileSearch>

export const Route = createFileRoute("/_authed/profile")({
  component: Profile,
  validateSearch: (search: Record<string, unknown>): ProfileSearch =>
    Option.getOrElse(decodeProfileSearch(search), () => ({})),
  loader: () => ({
    crumb: {
      type: "static" as const,
      label: m.profile_crumb_label(),
      to: "/profile"
    }
  })
})

function Profile() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const me = useAtomValue(meAtom)
  const githubOAuthError = useRef(githubOAuthErrorMessage(search.error)).current
  const figmaOAuthError = useRef(
    figmaOAuthErrorMessage(search.figmaError)
  ).current

  useEffect(() => {
    if (!search.error && !search.figmaError) return
    void navigate({
      to: ".",
      search: () => ({}),
      replace: true
    })
  }, [navigate, search.error, search.figmaError])

  if (!Result.isSuccess(me)) return null
  const user = me.value

  return (
    <PageContainer>
      <PageHeader>
        <h1>{m.profile_page_title()}</h1>
        <p>{m.profile_page_subtitle()}</p>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>{m.profile_section_account_title()}</CardTitle>
          <CardDescription>
            {m.profile_section_account_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Identity hero — avatar + name + the @username/email pair, same
              treatment as a member row in the project members tab so the
              "this is you" view reads like the "this is them" views. */}
          <div className="flex items-center gap-4">
            <MemberAvatar member={user} size={64} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-lg font-semibold">{user.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {user.username && (
                  <>
                    <span className="font-mono">@{user.username}</span>
                    <span className="mx-1.5">·</span>
                  </>
                )}
                {user.email}
              </div>
            </div>
          </div>

          <div className="grid gap-3 border-t border-border pt-4 text-sm">
            <Row label={m.profile_user_id_label()} value={user.id} mono />
            <Row
              label={m.profile_joined_label()}
              value={user.createdAt.toLocaleDateString(getLocale())}
            />
          </div>
        </CardContent>
      </Card>

      <PersonalGithubCard
        connected={user.personalGithub.connected}
        email={user.email}
        oauthError={githubOAuthError}
      />

      <PersonalEverhourCard everhour={user.personalEverhour} />
      <FigmaProfileSettings oauthError={figmaOAuthError} />
      <EditorPreferenceCard preference={user.editorPreference} />

      <Card>
        <CardHeader>
          <CardTitle>{m.profile_section_security_title()}</CardTitle>
          <CardDescription>
            {m.profile_section_security_description()}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {m.profile_section_security_empty()}
        </CardContent>
      </Card>

      <ConnectedAgentsSection />
    </PageContainer>
  )
}

function PersonalEverhourCard({
  everhour
}: {
  everhour: {
    connected: boolean
    everhourUserId: string | null
    name: string | null
    email: string | null
    lastCheckError: string | null
  }
}) {
  const [apiKey, setApiKey] = useState("")
  const connect = useAtomSet(connectEverhourProfileAtom, { mode: "promise" })
  const disconnect = useAtomSet(disconnectEverhourProfileAtom, {
    mode: "promise"
  })
  const connectState = useAtomValue(connectEverhourProfileAtom)
  const disconnectState = useAtomValue(disconnectEverhourProfileAtom)
  const waiting = connectState.waiting || disconnectState.waiting
  const error = Result.isFailure(connectState)
    ? m.profile_everhour_connect_error()
    : Result.isFailure(disconnectState)
      ? m.profile_everhour_disconnect_error()
      : everhour.lastCheckError

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    await connect({ apiKey: trimmed })
    setApiKey("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.profile_everhour_title()}</CardTitle>
        <CardDescription>{m.profile_everhour_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className={waiting ? "min-w-0 animate-pulse" : "min-w-0"}>
            <div className="text-sm font-medium">
              {everhour.connected
                ? m.profile_everhour_connected_status()
                : m.profile_everhour_disconnected_status()}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {everhour.connected
                ? (everhour.email ?? everhour.name ?? everhour.everhourUserId)
                : m.profile_everhour_disconnected_description()}
            </div>
          </div>
          {everhour.connected ? (
            <Button
              type="button"
              variant="secondary"
              disabled={waiting}
              onClick={() => void disconnect()}
            >
              {m.profile_everhour_disconnect_button()}
            </Button>
          ) : null}
        </div>
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          <Input
            type="password"
            value={apiKey}
            autoComplete="off"
            placeholder={m.profile_everhour_api_key_placeholder()}
            aria-label={m.profile_everhour_api_key_label()}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button type="submit" disabled={waiting || !apiKey.trim()}>
            {everhour.connected
              ? m.profile_everhour_update_button()
              : m.profile_everhour_connect_button()}
          </Button>
        </form>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function PersonalGithubCard({
  connected,
  email,
  oauthError
}: {
  connected: boolean
  email: string
  oauthError: string | null
}) {
  const connect = useAtomSet(connectPersonalGithubAtom, { mode: "promise" })
  const disconnect = useAtomSet(disconnectPersonalGithubAtom, {
    mode: "promise"
  })
  const connectState = useAtomValue(connectPersonalGithubAtom)
  const disconnectState = useAtomValue(disconnectPersonalGithubAtom)
  const connecting = connectState.waiting
  const waiting = connecting || disconnectState.waiting
  const error = Result.isFailure(connectState)
    ? m.profile_github_connect_error()
    : Result.isFailure(disconnectState)
      ? m.profile_github_disconnect_error()
      : oauthError

  const handleConnect = () => {
    void connect()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.profile_github_title()}</CardTitle>
        <CardDescription>{m.profile_github_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-foreground">
              <img
                src={githubLogo}
                alt=""
                className="size-4 dark:invert"
                aria-hidden
              />
            </span>
            <div className={waiting ? "min-w-0 animate-pulse" : "min-w-0"}>
              <div className="text-sm font-medium">
                {connected
                  ? m.profile_github_connected_status()
                  : m.profile_github_disconnected_status()}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {connected ? email : m.profile_github_description()}
              </div>
            </div>
          </div>
          {connected ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" onClick={handleConnect} disabled={waiting}>
                {m.profile_github_reconnect_button()}
              </Button>
              <GithubDisconnectAction
                disconnect={disconnect}
                disconnecting={disconnectState.waiting}
              />
            </div>
          ) : (
            <Button type="button" onClick={handleConnect} disabled={connecting}>
              {m.profile_github_connect_button()}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function githubOAuthErrorMessage(error: string | undefined): string | null {
  switch (error) {
    case undefined:
      return null
    case "account_already_linked_to_different_user":
      return m.profile_github_error_account_already_linked()
    case "access_denied":
      return m.profile_github_error_access_denied()
    case "email_doesn't_match":
      return m.profile_github_error_email_mismatch()
    case "email_not_found":
    case "unable_to_get_user_info":
      return m.profile_github_error_missing_profile()
    case "invalid_code":
    case "no_code":
    case "state_mismatch":
    case "please_restart_the_process":
      return m.profile_github_error_expired()
    case "unable_to_link_account":
    case "oauth_provider_not_found":
    case "signup_disabled":
    case "no_callback_url":
    case "invalid_callback_request":
    default:
      return m.profile_github_error_generic()
  }
}

function figmaOAuthErrorMessage(error: string | undefined): string | null {
  switch (error) {
    case undefined:
      return null
    case "figma_oauth_callback_invalid":
      return errorMessage(new FigmaAuthInvalid({}))
    case "figma_oauth_start_failed":
    case "figma_oauth_callback_failed":
    default:
      return errorMessage(new FigmaError({ reason: error }))
  }
}

function GithubDisconnectAction({
  disconnect,
  disconnecting
}: {
  disconnect: () => Promise<void>
  disconnecting: boolean
}) {
  return (
    <ConfirmButton.Root className="justify-end">
      <ConfirmButton.Trigger
        type="button"
        variant="secondary"
        disabled={disconnecting}
      >
        {m.profile_github_disconnect_button()}
      </ConfirmButton.Trigger>
      <ConfirmButton.Confirm className="flex-wrap justify-end">
        <GithubDisconnectConfirm
          disconnect={disconnect}
          disconnecting={disconnecting}
        />
      </ConfirmButton.Confirm>
    </ConfirmButton.Root>
  )
}

function GithubDisconnectConfirm({
  disconnect,
  disconnecting
}: {
  disconnect: () => Promise<void>
  disconnecting: boolean
}) {
  const { close, busy, setBusy } = useConfirmButton()

  async function run() {
    setBusy(true)
    try {
      await disconnect()
      close()
    } catch {
      setBusy(false)
    }
  }

  return (
    <>
      <span className="inline-flex h-8 items-center whitespace-nowrap text-xs text-muted-foreground">
        {m.profile_github_disconnect_confirm_prompt()}
      </span>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => void run()}
        disabled={busy || disconnecting}
      >
        {busy || disconnecting
          ? m.profile_github_disconnect_in_progress()
          : m.profile_github_disconnect_confirm_button()}
      </Button>
      <ConfirmButton.Cancel>{m.common_cancel_button()}</ConfirmButton.Cancel>
    </>
  )
}

const EDITOR_OPTIONS: ReadonlyArray<{
  key: EditorPreference
  label: () => string
}> = [
  { key: "github", label: m.profile_editor_option_github },
  { key: "github_dev", label: m.profile_editor_option_github_dev },
  { key: "vscode", label: m.profile_editor_option_vscode },
  { key: "cursor", label: m.profile_editor_option_cursor }
]

function editorHint(preference: EditorPreference): string {
  switch (preference) {
    case "github_dev":
      return m.profile_editor_hint_github_dev()
    case "vscode":
      return m.profile_editor_hint_vscode()
    case "cursor":
      return m.profile_editor_hint_cursor()
    case "github":
    default:
      return m.profile_editor_hint_github()
  }
}

function EditorPreferenceCard({
  preference
}: {
  preference: EditorPreference
}) {
  const update = useAtomSet(updateEditorPreferenceAtom, { mode: "promise" })
  const updateState = useAtomValue(updateEditorPreferenceAtom)
  const [selected, setSelected] = useState(preference)

  useEffect(() => {
    setSelected(preference)
  }, [preference])

  const waiting = updateState.waiting
  const error = Result.isFailure(updateState)
    ? m.profile_editor_update_error()
    : null

  function choose(next: EditorPreference) {
    if (next === selected) return
    setSelected(next)
    void update(next).catch(() => setSelected(preference))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.profile_editor_title()}</CardTitle>
        <CardDescription>{m.profile_editor_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <SegmentedTabs
          items={EDITOR_OPTIONS.map(({ key, label }) => ({
            key,
            label: label()
          }))}
          layoutId="editor-preference"
          isActive={(key) => key === selected}
          renderItem={(item, content, { active }) => (
            <button
              type="button"
              onClick={() => choose(item.key)}
              disabled={waiting}
              aria-pressed={active}
              className={cn(
                SEGMENTED_ITEM_CLASS(active),
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              {content}
            </button>
          )}
        />
        <p
          className={cn(
            "text-xs text-muted-foreground",
            waiting && "animate-pulse"
          )}
        >
          {editorHint(selected)}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  value,
  mono
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  )
}

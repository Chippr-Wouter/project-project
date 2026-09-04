import { type FormEvent, useState } from "react"
import { Result, useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import {
  connectFigmaProjectAtom,
  disconnectFigmaProjectAtom,
  figmaProjectStatusAtom
} from "@/atoms/figma"
import { projectKey } from "@/atoms/projects"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type AppError, errorMessage } from "@/lib/errorMessage"
import { m } from "@/paraglide/messages"

export function FigmaProjectSettings({
  orgSlug,
  slug,
  canManage
}: {
  orgSlug: string
  slug: string
  canManage: boolean
}) {
  const key = projectKey(orgSlug, slug)
  const status = useAtomValue(figmaProjectStatusAtom(key))

  return Result.matchWithError(status, {
    onInitial: () => (
      <div className="h-16 animate-pulse rounded-lg border border-border bg-background" />
    ),
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value, waiting }) => (
      <FigmaProjectContent
        orgSlug={orgSlug}
        slug={slug}
        status={value}
        waiting={waiting}
        canManage={canManage}
      />
    )
  })
}

function FigmaProjectContent({
  orgSlug,
  slug,
  status,
  waiting,
  canManage
}: {
  orgSlug: string
  slug: string
  status: {
    connected: boolean
    handle: string | null
    lastCheckError: string | null
    storageConnected: boolean
  }
  waiting: boolean
  canManage: boolean
}) {
  const key = projectKey(orgSlug, slug)
  const [accessToken, setAccessToken] = useState("")
  const connect = useAtomSet(connectFigmaProjectAtom(key), {
    mode: "promise"
  })
  const disconnect = useAtomSet(disconnectFigmaProjectAtom(key), {
    mode: "promise"
  })
  const connectState = useAtomValue(connectFigmaProjectAtom(key))
  const disconnectState = useAtomValue(disconnectFigmaProjectAtom(key))
  const busy = waiting || connectState.waiting || disconnectState.waiting

  const mutationError =
    Result.matchWithError(connectState, {
      onInitial: () => null,
      onSuccess: () => null,
      onError: (err) => errorMessage(err as AppError),
      onDefect: () => m.error_unknown()
    }) ??
    Result.matchWithError(disconnectState, {
      onInitial: () => null,
      onSuccess: () => null,
      onError: (err) => errorMessage(err as AppError),
      onDefect: () => m.error_unknown()
    })
  const error = status.lastCheckError ?? mutationError

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = accessToken.trim()
    if (!trimmed || !status.storageConnected) return
    await connect({ accessToken: trimmed })
    setAccessToken("")
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className={busy ? "min-w-0 animate-pulse" : "min-w-0"}>
          <p className="text-sm font-medium">{m.figma_project_title()}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.storageConnected
              ? m.figma_project_description()
              : m.figma_project_storage_required()}
          </p>
          {status.handle ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {status.handle}
            </p>
          ) : null}
        </div>
        {canManage && status.connected ? (
          <Button
            type="button"
            variant="secondary"
            loading={disconnectState.waiting}
            disabled={busy}
            onClick={() => void disconnect()}
          >
            {m.figma_project_disconnect_button()}
          </Button>
        ) : null}
      </div>
      {canManage && !status.connected ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => void submit(event)}
        >
          <Input
            type="password"
            value={accessToken}
            autoComplete="off"
            disabled={!status.storageConnected}
            placeholder={m.figma_project_token_label()}
            aria-label={m.figma_project_token_label()}
            onChange={(event) => setAccessToken(event.target.value)}
          />
          <Button
            type="submit"
            loading={connectState.waiting}
            disabled={busy || !accessToken.trim() || !status.storageConnected}
          >
            {m.figma_project_connect_button()}
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

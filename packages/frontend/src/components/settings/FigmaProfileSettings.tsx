import type { ReactNode } from "react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { figmaProfileAtom, disconnectFigmaProfileAtom } from "@/atoms/figma"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { type AppError, errorMessage } from "@/lib/errorMessage"
import { m } from "@/paraglide/messages"

export function FigmaProfileSettings({
  oauthError
}: {
  oauthError: string | null
}) {
  const profile = useAtomValue(figmaProfileAtom)

  return Result.matchWithError(profile, {
    onInitial: () => (
      <FigmaProfileCard>
        <div className="h-8 animate-pulse rounded bg-muted/40" />
      </FigmaProfileCard>
    ),
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value, waiting }) => (
      <FigmaProfileContent
        profile={value}
        waiting={waiting}
        oauthError={oauthError}
      />
    )
  })
}

function FigmaProfileContent({
  profile,
  waiting,
  oauthError
}: {
  profile: {
    connected: boolean
    handle: string | null
    email: string | null
  }
  waiting: boolean
  oauthError: string | null
}) {
  const disconnect = useAtomSet(disconnectFigmaProfileAtom, {
    mode: "promise"
  })
  const disconnectState = useAtomValue(disconnectFigmaProfileAtom)
  const busy = waiting || disconnectState.waiting
  const disconnectError = Result.matchWithError(disconnectState, {
    onInitial: () => null,
    onSuccess: () => null,
    onError: (err) => errorMessage(err as AppError),
    onDefect: () => m.error_unknown()
  })
  const error = oauthError ?? disconnectError

  return (
    <FigmaProfileCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={busy ? "min-w-0 animate-pulse" : "min-w-0"}>
          <div className="text-sm font-medium">
            {profile.connected
              ? m.figma_profile_connected_status({
                  handle: profile.handle ?? profile.email ?? ""
                })
              : m.figma_profile_disconnected_status()}
          </div>
        </div>
        {profile.connected ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            {m.figma_profile_disconnect_button()}
          </Button>
        ) : (
          <Button render={<a href="/api/integrations/figma/oauth/start" />}>
            {m.figma_profile_connect_button()}
          </Button>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </FigmaProfileCard>
  )
}

function FigmaProfileCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.figma_profile_title()}</CardTitle>
        <CardDescription>{m.figma_profile_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  )
}

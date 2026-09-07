import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Info } from "lucide-react"
import { useState } from "react"
import type { TicketDetail } from "@projectproject/shared"
import {
  everhourProfileAtom,
  everhourProjectStatusAtom
} from "@/atoms/everhour"
import { projectKey } from "@/atoms/projects"
import {
  activeTimerAtom,
  startTicketTimerAtom,
  stopTimerAtom,
  ticketKey,
  ticketTimeAtom,
  workTypesForTicketAtom
} from "@/atoms/timeTracking"
import { ConnectEverhourInline } from "@/components/time/ConnectEverhourInline"
import { EverhourSetupHint } from "@/components/time/EverhourSetupHint"
import { LogTimeForm } from "@/components/time/LogTimeForm"
import { TimeControls } from "@/components/time/TimeControls"
import { ErrorPage } from "@/components/ErrorPage"
import { MetaRow } from "@/components/TicketPage/MetaRow"
import { useProjectRole } from "@/lib/projectRole"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import * as m from "@/paraglide/messages"

export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0 && minutes === 0)
    return m.time_duration_minutes({ minutes: 0 })
  return [
    ...(hours > 0 ? [m.time_duration_hours({ hours })] : []),
    ...(minutes > 0 ? [m.time_duration_minutes({ minutes })] : [])
  ].join(" ")
}

export function TicketTimeSection({
  orgSlug,
  slug,
  ticket
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
}) {
  const statusResult = useAtomValue(
    everhourProjectStatusAtom(projectKey(orgSlug, slug))
  )
  const { isOwner, isAdmin } = useProjectRole()
  const canManage = isOwner || isAdmin

  const notConnected =
    Result.isSuccess(statusResult) &&
    statusResult.value.status === "not_connected"
  if (notConnected && !canManage) return null

  return (
    <MetaRow label={m.time_section_label()}>
      {Result.matchWithError(statusResult, {
        onInitial: () => (
          <div className="h-8 animate-pulse rounded bg-muted/40" />
        ),
        onError: (error) => <ErrorPage error={error} contained />,
        onDefect: (defect) => <ErrorPage error={defect} contained />,
        onSuccess: ({ value }) =>
          value.status === "not_connected" ? (
            <EverhourSetupHint orgSlug={orgSlug} slug={slug} />
          ) : (
            <TicketTimePanel orgSlug={orgSlug} slug={slug} ticket={ticket} />
          )
      })}
    </MetaRow>
  )
}

export function TicketTimePanel({
  orgSlug,
  slug,
  ticket
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
}) {
  const tKey = ticketKey(orgSlug, slug, ticket.id)
  const profileResult = useAtomValue(everhourProfileAtom)
  const workTypesResult = useAtomValue(workTypesForTicketAtom(tKey))
  const timeResult = useAtomValue(ticketTimeAtom(tKey))
  const activeTimerResult = useAtomValue(activeTimerAtom(orgSlug))
  const start = useAtomSet(startTicketTimerAtom(tKey), { mode: "promiseExit" })
  const startState = useAtomValue(startTicketTimerAtom(tKey))
  const stop = useAtomSet(stopTimerAtom(orgSlug), { mode: "promiseExit" })
  const stopState = useAtomValue(stopTimerAtom(orgSlug))
  const [workType, setWorkType] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)

  if (Result.isInitial(profileResult)) {
    return <div className="h-8 animate-pulse rounded bg-muted/40" />
  }

  if (Result.isFailure(profileResult)) {
    return Result.matchWithError(profileResult, {
      onInitial: () => null,
      onError: (error) => <ErrorPage error={error} contained />,
      onDefect: (defect) => <ErrorPage error={defect} contained />,
      onSuccess: () => null
    })
  }

  const connected =
    Result.isSuccess(profileResult) && profileResult.value.connected
  if (!connected) {
    return <ConnectEverhourInline />
  }

  if (Result.isInitial(timeResult) || Result.isInitial(activeTimerResult)) {
    return <div className="h-16 animate-pulse rounded bg-muted/40" />
  }
  if (Result.isFailure(timeResult)) {
    return Result.matchWithError(timeResult, {
      onInitial: () => null,
      onError: (error) => <ErrorPage error={error} contained />,
      onDefect: (defect) => <ErrorPage error={defect} contained />,
      onSuccess: () => null
    })
  }
  if (Result.isFailure(activeTimerResult)) {
    return Result.matchWithError(activeTimerResult, {
      onInitial: () => null,
      onError: (error) => <ErrorPage error={error} contained />,
      onDefect: (defect) => <ErrorPage error={defect} contained />,
      onSuccess: () => null
    })
  }

  return Result.matchWithError(workTypesResult, {
    onInitial: () => <div className="h-8 animate-pulse rounded bg-muted/40" />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value: options }) => {
      if (options.length === 0) {
        return (
          <p className="text-xs text-muted-foreground">
            {m.time_no_sprint_hint()}
          </p>
        )
      }
      const effectiveWorkType = workType ?? options[0].key
      const running =
        activeTimerResult.value !== null &&
        activeTimerResult.value.ticketId === ticket.id
      const busy =
        startState.waiting || stopState.waiting || activeTimerResult.waiting
      const timePulse =
        timeResult.waiting ||
        activeTimerResult.waiting ||
        startState.waiting ||
        stopState.waiting

      return (
        <div className="flex flex-col gap-3">
          <div
            className={
              timePulse
                ? "flex items-center gap-5 tabular-nums animate-pulse"
                : "flex items-center gap-5 tabular-nums"
            }
          >
            <TrackedFigure
              label={m.time_tracked_total()}
              seconds={timeResult.value.totalSeconds}
            />
            <TrackedFigure
              label={m.time_tracked_yours()}
              seconds={timeResult.value.userSeconds}
            />
            <Popover>
              <PopoverTrigger
                aria-label={m.time_sync_explainer()}
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:text-foreground active:scale-[0.97]"
              >
                <Info className="h-4 w-4" />
              </PopoverTrigger>
              <PopoverContent className="w-72 text-xs text-muted-foreground">
                {m.time_sync_explainer()}
              </PopoverContent>
            </Popover>
          </div>

          <TimeControls
            value={effectiveWorkType}
            onValueChange={setWorkType}
            options={options}
            running={running}
            busy={busy}
            onStart={() => void start({ workTypeKey: effectiveWorkType })}
            onStop={() => void stop()}
            logOpen={showLog}
            onLogOpenChange={setShowLog}
          >
            <LogTimeForm
              orgSlug={orgSlug}
              slug={slug}
              ticketId={ticket.id}
              options={options}
              defaultWorkType={effectiveWorkType}
              onDone={() => setShowLog(false)}
            />
          </TimeControls>
        </div>
      )
    }
  })
}

function TrackedFigure({ label, seconds }: { label: string; seconds: number }) {
  return (
    <div className="flex min-w-20 flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">
        {formatDuration(seconds)}
      </span>
    </div>
  )
}

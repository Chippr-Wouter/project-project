import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useLocation } from "@tanstack/react-router"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import { Timer } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { useEffect, useMemo, useState } from "react"
import {
  DEFAULT_WORK_TYPES,
  GroupId,
  TicketId,
  pickActiveSprint,
  pickEarliestPlannedSprint,
  type ActiveTimer,
  type Group
} from "@projectproject/shared"
import {
  everhourProfileAtom,
  everhourProjectStatusAtom
} from "@/atoms/everhour"
import { projectKey as projectAtomKey } from "@/atoms/projects"
import {
  projectKey as sprintsProjectKey,
  sprintsListAtom
} from "@/atoms/sprints"
import {
  activeTimerAtom,
  groupKey,
  startSprintTimerAtom,
  startTicketTimerAtom,
  stopTimerAtom,
  ticketKey,
  workTypesForTicketAtom
} from "@/atoms/timeTracking"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from "@/components/ui/select"
import { LogTimeForm } from "@/components/time/LogTimeForm"
import { TimeControls } from "@/components/time/TimeControls"
import { transitions } from "@/lib/springs"
import * as m from "@/paraglide/messages"

const decodeGroupId = Schema.decodeUnknownSync(GroupId)
const decodeTicketId = Schema.decodeUnknownSync(TicketId)
const placeholderGroupId = decodeGroupId("G-1")
const placeholderTicketId = decodeTicketId("T-1")

const options = DEFAULT_WORK_TYPES.map((workType) => ({
  key: workType.key,
  label: workType.label
}))
const defaultWorkTypesResultAtom = Atom.make(Result.success(options))

const elapsedSeconds = (startedAt: Date): number =>
  Math.max(
    0,
    Math.floor(
      (DateTime.toEpochMillis(DateTime.nowUnsafe()) - startedAt.getTime()) /
        1000
    )
  )

const padClockPart = (value: number): string => `${value}`.padStart(2, "0")

export const formatClock = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  return hours > 0
    ? `${hours}:${padClockPart(minutes)}:${padClockPart(secs)}`
    : `${minutes}:${padClockPart(secs)}`
}

export const timerEntryMotion = (reduceMotion: boolean) =>
  reduceMotion
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: -2 }, animate: { opacity: 1, y: 0 } }

export const startSecondInterval = (update: () => void): (() => void) => {
  update()
  const interval = window.setInterval(update, 1000)
  return () => window.clearInterval(interval)
}

function useElapsed(startedAt: Date | null): number {
  const [seconds, setSeconds] = useState(() =>
    startedAt ? elapsedSeconds(startedAt) : 0
  )
  useEffect(() => {
    if (!startedAt) {
      setSeconds(0)
      return undefined
    }
    const update = () => setSeconds(elapsedSeconds(startedAt))
    return startSecondInterval(update)
  }, [startedAt])
  return seconds
}

type ProjectRouteContext = {
  slug: string
  groupId: GroupId | null
  ticketId: TicketId | null
}

function routeContext(
  pathname: string,
  orgSlug: string
): ProjectRouteContext | null {
  const prefix = `/orgs/${orgSlug}/projects/`
  if (!pathname.startsWith(prefix)) return null
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean)
  const slug = parts[0]
  if (!slug) return null
  const sprintIndex = parts.indexOf("sprints")
  if (sprintIndex === -1 || !parts[sprintIndex + 1]) {
    const ticketIndex = parts.indexOf("tickets")
    if (ticketIndex === -1 || !parts[ticketIndex + 1]) {
      return { slug, groupId: null, ticketId: null }
    }
    try {
      return {
        slug,
        groupId: null,
        ticketId: decodeTicketId(parts[ticketIndex + 1])
      }
    } catch {
      return { slug, groupId: null, ticketId: null }
    }
  }
  try {
    return {
      slug,
      groupId: decodeGroupId(parts[sprintIndex + 1]),
      ticketId: null
    }
  } catch {
    return { slug, groupId: null, ticketId: null }
  }
}

function defaultSprint(
  sprints: ReadonlyArray<Group>,
  routeGroupId: GroupId | null,
  timer: ActiveTimer | null,
  slug: string
): Group | null {
  if (routeGroupId) {
    const routeSprint = sprints.find((s) => s.id === routeGroupId)
    if (routeSprint) return routeSprint
  }
  if (timer?.slug === slug) {
    const runningSprint = sprints.find((s) => s.id === timer.groupId)
    if (runningSprint) return runningSprint
  }
  return (
    pickActiveSprint(sprints) ??
    pickEarliestPlannedSprint(sprints) ??
    sprints.find((s) => s.completedAt === null) ??
    sprints[0] ??
    null
  )
}

function timerLabel(timer: ActiveTimer): string {
  return timer.ticketId !== null
    ? `${timer.ticketId} · ${timer.workTypeLabel}`
    : timer.workTypeLabel
}

export function RunningTimerIndicator({ orgSlug }: { orgSlug: string }) {
  const { pathname } = useLocation()
  const activeTimerResult = useAtomValue(activeTimerAtom(orgSlug))
  const timer = Result.isSuccess(activeTimerResult)
    ? activeTimerResult.value
    : null
  const context = routeContext(pathname, orgSlug)
  const slug = timer?.slug ?? context?.slug ?? null

  if (Result.isInitial(activeTimerResult)) {
    return <div className="h-7 w-48 animate-pulse rounded-lg bg-accent/60" />
  }
  if (!slug) return null

  return (
    <ProjectTimerIndicator
      orgSlug={orgSlug}
      slug={slug}
      routeGroupId={context?.slug === slug ? context.groupId : null}
      ticketId={context?.slug === slug ? context.ticketId : null}
      timer={timer}
      timerWaiting={activeTimerResult.waiting}
    />
  )
}

type ProjectTimerProps = {
  orgSlug: string
  slug: string
  routeGroupId: GroupId | null
  ticketId: TicketId | null
  timer: ActiveTimer | null
  timerWaiting: boolean
}

function ProjectTimerIndicator(props: ProjectTimerProps) {
  const { orgSlug, slug } = props
  const status = useAtomValue(
    everhourProjectStatusAtom(projectAtomKey(orgSlug, slug))
  )
  if (Result.isInitial(status)) {
    return <div className="h-7 w-48 animate-pulse rounded-lg bg-accent/60" />
  }
  if (!Result.isSuccess(status) || status.value.status === "not_connected") {
    return null
  }
  return (
    <ConnectedProjectTimerIndicator key={`${orgSlug}/${slug}`} {...props} />
  )
}

function ConnectedProjectTimerIndicator({
  orgSlug,
  slug,
  routeGroupId,
  ticketId,
  timer,
  timerWaiting
}: ProjectTimerProps) {
  const profileResult = useAtomValue(everhourProfileAtom)
  const sprintsResult = useAtomValue(
    sprintsListAtom(sprintsProjectKey(orgSlug, slug))
  )
  const ticketTimerKey = ticketKey(
    orgSlug,
    slug,
    ticketId ?? placeholderTicketId
  )
  const ticketWorkTypesResult = useAtomValue(
    ticketId !== null
      ? workTypesForTicketAtom(ticketTimerKey)
      : defaultWorkTypesResultAtom
  )
  const stop = useAtomSet(stopTimerAtom(orgSlug), { mode: "promiseExit" })
  const stopState = useAtomValue(stopTimerAtom(orgSlug))
  const reduceMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [workType, setWorkType] = useState(options[0].key)
  const [showLog, setShowLog] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<GroupId | null>(
    routeGroupId
  )
  const elapsed = useElapsed(timer ? timer.startedAt : null)
  const connected =
    Result.isSuccess(profileResult) && profileResult.value.connected
  const sprints = useMemo(
    () => (Result.isSuccess(sprintsResult) ? sprintsResult.value : []),
    [sprintsResult]
  )
  const selectedSprint = selectedGroupId
    ? sprints.find((s) => s.id === selectedGroupId)
    : null
  const fallbackSprint = defaultSprint(sprints, routeGroupId, timer, slug)
  const effectiveSprint = selectedSprint ?? fallbackSprint
  const effectiveGroupId = effectiveSprint?.id ?? null
  const runningForSelected =
    timer !== null &&
    timer.slug === slug &&
    (ticketId !== null
      ? timer.ticketId === ticketId
      : timer.ticketId === null &&
        effectiveGroupId !== null &&
        timer.groupId === effectiveGroupId)
  const startKey = groupKey(
    orgSlug,
    slug,
    effectiveGroupId ?? placeholderGroupId
  )
  const start = useAtomSet(startSprintTimerAtom(startKey), {
    mode: "promiseExit"
  })
  const startState = useAtomValue(startSprintTimerAtom(startKey))
  const startTicket = useAtomSet(startTicketTimerAtom(ticketTimerKey), {
    mode: "promiseExit"
  })
  const startTicketState = useAtomValue(startTicketTimerAtom(ticketTimerKey))
  const ticketOptionsLoading =
    ticketId !== null && Result.isInitial(ticketWorkTypesResult)
  const availableOptions = useMemo(
    () =>
      ticketId !== null
        ? Result.isSuccess(ticketWorkTypesResult)
          ? ticketWorkTypesResult.value
          : []
        : options,
    [ticketId, ticketWorkTypesResult]
  )
  const busy =
    timerWaiting ||
    startState.waiting ||
    startTicketState.waiting ||
    stopState.waiting ||
    ticketOptionsLoading

  useEffect(() => {
    const next = defaultSprint(sprints, routeGroupId, timer, slug)
    if (!next) {
      setSelectedGroupId(null)
      return
    }
    setSelectedGroupId((current) =>
      current && sprints.some((s) => s.id === current) ? current : next.id
    )
  }, [routeGroupId, slug, sprints, timer])

  useEffect(() => {
    if (timer?.workTypeKey) setWorkType(timer.workTypeKey)
  }, [timer?.workTypeKey])

  useEffect(() => {
    if (!availableOptions.some((option) => option.key === workType)) {
      const first = availableOptions[0]
      if (first) setWorkType(first.key)
    }
  }, [availableOptions, workType])

  useEffect(() => {
    if (!open) setShowLog(false)
  }, [open])

  if (Result.isInitial(profileResult)) {
    return <div className="h-7 w-48 animate-pulse rounded-lg bg-accent/60" />
  }
  if (!connected) return null

  const label = timer ? timerLabel(timer) : m.time_timer_idle()
  const trigger = (
    <button
      type="button"
      aria-label={
        timer ? m.time_timer_running_on({ label }) : m.time_timer_open()
      }
      className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-accent/60 px-2 py-1 text-left outline-none transition-colors transition-transform duration-100 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
    >
      <Timer
        className="size-4 shrink-0 text-muted-foreground"
        strokeWidth={1.75}
      />
      <motion.span
        initial={timerEntryMotion(reduceMotion ?? false).initial}
        animate={timerEntryMotion(reduceMotion ?? false).animate}
        transition={transitions.fade}
        className="flex min-w-0 items-center gap-2"
      >
        <span className="max-w-40 truncate text-[13px]">{label}</span>
        {timer ? (
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {formatClock(elapsed)}
          </span>
        ) : null}
      </motion.span>
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(34rem,calc(100vw-2rem))]"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {m.time_timer_popover_title()}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {timer ? label : m.time_timer_idle()}
              </div>
            </div>
            {timer ? (
              <div className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatClock(elapsed)}
              </div>
            ) : null}
          </div>

          {ticketId !== null ? (
            <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {m.time_ticket_context({ id: ticketId })}
            </div>
          ) : routeGroupId ? null : (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              {m.time_sprint_label()}
              <SprintSelect
                value={effectiveGroupId}
                sprints={sprints}
                disabled={busy || sprints.length === 0}
                onChange={setSelectedGroupId}
              />
            </label>
          )}

          {ticketId !== null || effectiveGroupId ? (
            <TimeControls
              value={workType}
              onValueChange={setWorkType}
              options={availableOptions}
              running={runningForSelected}
              busy={busy}
              onStart={() =>
                ticketId !== null
                  ? void startTicket({ workTypeKey: workType })
                  : void start({ workTypeKey: workType })
              }
              onStop={() => void stop()}
              logOpen={showLog}
              onLogOpenChange={setShowLog}
            >
              <LogTimeForm
                orgSlug={orgSlug}
                slug={slug}
                ticketId={ticketId}
                groupId={ticketId ? undefined : effectiveGroupId}
                options={availableOptions}
                defaultWorkType={workType}
                onDone={() => {
                  setShowLog(false)
                  setOpen(false)
                }}
              />
            </TimeControls>
          ) : (
            <p className="text-xs text-muted-foreground">
              {m.time_no_sprints_hint()}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function SprintSelect({
  value,
  sprints,
  disabled,
  onChange
}: {
  value: GroupId | null
  sprints: ReadonlyArray<Group>
  disabled: boolean
  onChange: (value: GroupId) => void
}) {
  const selectedLabel =
    value === null
      ? null
      : (sprints.find((sprint) => sprint.id === value)?.name ?? null)
  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => onChange(decodeGroupId(next))}
      disabled={disabled}
    >
      <SelectTrigger
        placeholder={m.time_sprint_label()}
        selectedLabel={selectedLabel}
        aria-label={m.time_sprint_label()}
      />
      <SelectContent>
        {sprints.map((sprint, index) => (
          <SelectItem key={sprint.id} index={index} value={sprint.id}>
            {sprint.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import * as DateTime from "effect/DateTime"
import * as Exit from "effect/Exit"
import { motion, useReducedMotion } from "motion/react"
import { CircleCheck, Plus } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import type { DateRange } from "react-day-picker"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { InlineForm, useInlineForm } from "@/components/ui/inline-form"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { RailBackLink } from "@/components/RailBackLink"
import { cn } from "@/lib/utils"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"
import {
  createSprintAtom,
  projectKey as sprintProjectKey,
  sprintsListAtom
} from "@/atoms/sprints"
import { projectAtom, projectKey as projectRouteKey } from "@/atoms/projects"
import {
  pickActiveSprint,
  pickEarliestPlannedSprint,
  sprintState,
  type Group
} from "@projectproject/shared"
import { SprintStateIcon } from "./SprintChip"

function railDateFormatter() {
  return new Intl.DateTimeFormat(getLocale(), {
    month: "short",
    day: "numeric"
  })
}

function formatRange(s: Group): string {
  if (!s.startsAt || !s.endsAt) return ""
  const fmt = railDateFormatter()
  return `${fmt.format(s.startsAt)} – ${fmt.format(s.endsAt)}`
}
function sprintProjectLayoutId(orgSlug: string, slug: string) {
  return `project-settings-row:${orgSlug}/${slug}`
}

function defaultSprintRange(): DateRange {
  const now = DateTime.nowUnsafe()
  const today = DateTime.toDate(now)
  const end = DateTime.toDate(DateTime.add(now, { days: 14 }))
  return { from: today, to: end }
}

function sortByStart(a: Group, b: Group) {
  return (a.startsAt?.getTime() ?? 0) - (b.startsAt?.getTime() ?? 0)
}

export function SprintRail({
  orgSlug,
  slug
}: {
  orgSlug: string
  slug: string
}) {
  const key = sprintProjectKey(orgSlug, slug)
  const project = useAtomValue(projectAtom(projectRouteKey(orgSlug, slug)))
  const projectName = Result.isSuccess(project) ? project.value.name : slug
  const projectIcon = Result.isSuccess(project) ? project.value.icon : null
  const reduceMotion = useReducedMotion()
  const list = useAtomValue(sprintsListAtom(key))
  const sprints = Result.isSuccess(list) ? list.value : []
  const params = useParams({ strict: false }) as { groupId?: string }
  const selectedSprintId =
    params.groupId ?? pickSprintNavigationTarget(sprints)?.id
  const now = DateTime.toDate(DateTime.nowUnsafe())

  const active: Array<Group> = []
  const planned: Array<Group> = []
  const completed: Array<Group> = []
  for (const s of sprints) {
    const state = sprintState(s, now)
    if (state === "active") active.push(s)
    else if (state === "planned") planned.push(s)
    else completed.push(s)
  }
  active.sort(sortByStart)
  planned.sort(sortByStart)
  completed.sort(
    (a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
  )

  return (
    <div className="flex h-full flex-col gap-4">
      <RailBackLink
        to="/orgs/$orgSlug/projects/$slug"
        params={{ orgSlug, slug }}
        label={m.sprints_rail_section_label()}
      />
      <motion.div
        layoutId={
          reduceMotion ? undefined : sprintProjectLayoutId(orgSlug, slug)
        }
        transition={transitions.layout}
        className="flex items-center gap-2.5 rounded-lg bg-accent/60 px-3 py-2 text-[13px] text-foreground"
      >
        {projectIcon ? (
          <span
            aria-hidden
            className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden text-[13px] leading-none"
          >
            {projectIcon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate font-medium">
          {projectName}
        </span>
      </motion.div>
      <NewSprintForm orgSlug={orgSlug} slug={slug} />
      <div className="flex flex-col gap-5 overflow-y-auto">
        <Section
          label={m.sprints_active_label()}
          count={active.length}
          sprints={active}
          selectedSprintId={selectedSprintId}
          orgSlug={orgSlug}
          slug={slug}
        />
        <Section
          label={m.sprints_planned_label()}
          count={planned.length}
          sprints={planned}
          selectedSprintId={selectedSprintId}
          orgSlug={orgSlug}
          slug={slug}
        />
        <Section
          label={m.sprints_completed_label()}
          count={completed.length}
          sprints={completed}
          selectedSprintId={selectedSprintId}
          orgSlug={orgSlug}
          slug={slug}
          dim
        />
      </div>
    </div>
  )
}

function Section({
  label,
  count,
  sprints,
  selectedSprintId,
  orgSlug,
  slug,
  dim
}: {
  label: string
  count: number
  sprints: ReadonlyArray<Group>
  selectedSprintId?: string
  orgSlug: string
  slug: string
  dim?: boolean
}) {
  if (count === 0) return null
  return (
    <section className="flex flex-col gap-1">
      <header className="flex items-center justify-between px-2 text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono text-[10px] tabular-nums">{count}</span>
      </header>
      <ul className={cn("flex flex-col", dim && "opacity-80")}>
        {sprints.map((s) => (
          <li key={s.id}>
            <RailRow
              sprint={s}
              selected={selectedSprintId === s.id}
              orgSlug={orgSlug}
              slug={slug}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function RailRow({
  sprint,
  selected,
  orgSlug,
  slug
}: {
  sprint: Group
  selected: boolean
  orgSlug: string
  slug: string
}) {
  return (
    <Link
      to="/orgs/$orgSlug/projects/$slug/sprints/$groupId"
      params={{ orgSlug, slug, groupId: sprint.id }}
      className={cn(
        "group/list-row flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors",
        selected
          ? "bg-accent text-foreground font-medium"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
      aria-current={selected ? "page" : undefined}
    >
      <SprintStateIcon sprint={sprint} />
      <span className="min-w-0 flex-1 truncate">{sprint.name}</span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {formatRange(sprint)}
      </span>
    </Link>
  )
}

function pickSprintNavigationTarget(
  sprints: ReadonlyArray<Group>
): Group | null {
  const active = pickActiveSprint(sprints)
  if (active) return active
  const planned = pickEarliestPlannedSprint(sprints)
  if (planned) return planned
  const completed = sprints
    .filter((s) => s.completedAt !== null)
    .toSorted(
      (a, b) =>
        (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
    )
  return completed[0] ?? null
}

function NewSprintForm({ orgSlug, slug }: { orgSlug: string; slug: string }) {
  const Root = InlineForm.Root<"create">
  return (
    <Root className="data-[mode=idle]:border-0 data-[mode=idle]:bg-transparent data-[mode=idle]:p-0">
      <InlineForm.Idle block>
        <InlineForm.Trigger
          action="create"
          variant="dither"
          className="w-full justify-start text-primary-foreground"
          leadingIcon={Plus}
          ditherFrom="var(--primary)"
          ditherTo="var(--background)"
          ditherDirection="r"
          ditherStops={[0.7, 1]}
          ditherHoverStops={[0.5, 1]}
        >
          {m.sprints_new_button()}
        </InlineForm.Trigger>
      </InlineForm.Idle>
      <InlineForm.Form action="create">
        <CreateSprintFields orgSlug={orgSlug} slug={slug} />
      </InlineForm.Form>
    </Root>
  )
}

function CreateSprintFields({
  orgSlug,
  slug
}: {
  orgSlug: string
  slug: string
}) {
  const key = sprintProjectKey(orgSlug, slug)
  const create = useAtomSet(createSprintAtom(key), { mode: "promiseExit" })
  const state = useAtomValue(createSprintAtom(key))
  const error = Result.isFailure(state)
    ? m.sprints_create_error_fallback()
    : null
  const navigate = useNavigate()
  const { busy, setBusy, close } = useInlineForm<"create">()

  const [name, setName] = useState("")
  const [range, setRange] = useState<DateRange>(defaultSprintRange)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    setBusy(state.waiting)
  }, [state.waiting, setBusy])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || busy || !range.from || !range.to) return
    const exit = await create({
      name: trimmed,
      startsAt: range.from,
      endsAt: range.to
    })
    if (Exit.isSuccess(exit)) {
      const created = exit.value
      close()
      void navigate({
        to: "/orgs/$orgSlug/projects/$slug/sprints/$groupId",
        params: { orgSlug, slug, groupId: created.id }
      })
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={m.sprints_new_name_placeholder()}
        disabled={busy}
        className="w-full bg-transparent text-sm outline-none"
        maxLength={120}
      />
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="chip"
              disabled={busy}
              className="self-start text-muted-foreground hover:text-foreground"
            >
              <span className="font-mono text-[11px] tabular-nums">
                {range.from && range.to
                  ? (() => {
                      const fmt = railDateFormatter()
                      return `${fmt.format(range.from)} – ${fmt.format(range.to)}`
                    })()
                  : m.sprints_date_range_label()}
              </span>
            </Button>
          }
        />
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={range}
            onSelect={(r) => {
              if (r) setRange(r)
            }}
            numberOfMonths={1}
            defaultMonth={range.from ?? DateTime.toDate(DateTime.nowUnsafe())}
          />
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-1">
        <InlineForm.Cancel size="xs" variant="tertiary" leadingIcon={undefined}>
          {m.common_cancel_button()}
        </InlineForm.Cancel>
        <Button
          type="submit"
          variant="primary"
          size="xs"
          leadingIcon={CircleCheck}
          disabled={!name.trim() || !range.from || !range.to || busy}
        >
          {busy ? m.sprints_create_in_progress() : m.sprints_create_button()}
        </Button>
      </div>
    </form>
  )
}

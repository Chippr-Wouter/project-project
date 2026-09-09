import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import * as DateTime from "effect/DateTime"
import {
  Archive,
  Check,
  ChevronDown,
  SlidersHorizontal,
  UserRound
} from "lucide-react"
import { useRef, useState, type ComponentProps } from "react"
import { meAtom } from "@/atoms/auth"
import { CollapsingLabel } from "@/components/SegmentedTabs"
import { MemberAvatar } from "@/components/MemberAvatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { TagChip } from "@/components/TagChip"
import { SPRINT_STATE_META } from "@/components/sprints/SprintChip"
import { tagsAtom, tagsKey } from "@/atoms/tags"
import {
  projectKey as sprintsProjectKey,
  sprintsListAtom
} from "@/atoms/sprints"
import { TYPE_LABELS, TYPE_META } from "@/lib/ticket-meta"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import {
  sprintState,
  type TicketType,
  type TicketFilter,
  type Member
} from "@projectproject/shared"
import {
  activeFilterCount as countActiveFilters,
  type SprintFilterValue
} from "./model"
import { useTicketToolbar } from "./context"
import {
  ControlSlot,
  FilterSection,
  SectionLabel,
  ToolbarButton
} from "./shared"

export function Filters() {
  const {
    query,
    patchFilter: onChange,
    filters,
    members,
    orgSlug,
    slug,
    searchActive: compact
  } = useTicketToolbar()
  const value = query.filter
  const activeFilterCount = countActiveFilters(value, filters)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] =
    useState<ComponentProps<typeof DropdownMenuContent>["anchor"]>()
  const active = activeFilterCount > 0

  return (
    <ControlSlot>
      <DropdownMenu
        onOpenChange={(open) => {
          const trigger = triggerRef.current
          if (!open || !trigger) return
          const bounds = trigger.getBoundingClientRect()
          setAnchor({
            getBoundingClientRect: () => bounds,
            contextElement: trigger
          })
        }}
      >
        <DropdownMenuTrigger
          ref={triggerRef}
          render={
            <ToolbarButton
              active={active}
              aria-label={
                compact && active
                  ? m.tickets_filters_active_aria_label({
                      count: activeFilterCount
                    })
                  : m.tickets_filters_aria_label()
              }
            >
              <SlidersHorizontal className="size-4" strokeWidth={1.75} />
              <CollapsingLabel show={!compact}>
                {m.tickets_filters_label()}
              </CollapsingLabel>
              {active && (
                <span className="rounded-full bg-foreground/10 px-1.5 font-mono text-[10px] tabular-nums text-foreground">
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown className="size-3.5 opacity-60" strokeWidth={1.75} />
            </ToolbarButton>
          }
        />
        <DropdownMenuContent
          anchor={anchor}
          align="end"
          sideOffset={6}
          className="w-56"
          finalFocus={false}
        >
          {filters.map((dimension) => {
            switch (dimension) {
              case "archived":
                return (
                  <FilterArchived
                    key={dimension}
                    value={value?.archived}
                    onChange={(archived) => onChange({ archived })}
                  />
                )
              case "type":
                return (
                  <FilterType
                    key={dimension}
                    value={value?.type}
                    onChange={(type) => onChange({ type })}
                  />
                )
              case "assignee":
                return (
                  <FilterAssignee
                    key={dimension}
                    value={value?.assignee}
                    onChange={(assignee) => onChange({ assignee })}
                    members={members}
                  />
                )
              case "sprint":
                return (
                  <FilterSprint
                    key={dimension}
                    value={value?.groupId}
                    onChange={(groupId) => onChange({ groupId })}
                    orgSlug={orgSlug}
                    slug={slug}
                  />
                )
              case "tags":
                return (
                  <FilterTags
                    key={dimension}
                    value={value?.tags}
                    onChange={(tags) => onChange({ tags })}
                    orgSlug={orgSlug}
                    slug={slug}
                  />
                )
            }
            return null
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </ControlSlot>
  )
}

function FilterArchived({
  value,
  onChange
}: {
  value: TicketFilter["archived"]
  onChange: (value: TicketFilter["archived"]) => void
}) {
  const archivedFilter = value === true
  const setArchivedFilter = (on: boolean) => onChange(on ? true : undefined)
  return (
    <FilterSection>
      <SectionLabel>{m.tickets_filters_section_archived()}</SectionLabel>
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setArchivedFilter(!archivedFilter)}
        className="cursor-pointer"
      >
        <Archive className="size-4" strokeWidth={1.75} />
        {m.tickets_filters_archived_show()}
        {archivedFilter && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
    </FilterSection>
  )
}

function FilterType({
  value,
  onChange
}: {
  value: TicketFilter["type"]
  onChange: (value: TicketFilter["type"]) => void
}) {
  const types = value
  const typeFilter = types?.length === 1 ? types[0] : "all"
  const setTypeFilter = (type: TicketType | "all") =>
    onChange(type === "all" ? undefined : [type])
  return (
    <FilterSection>
      <SectionLabel>{m.tickets_filters_section_type()}</SectionLabel>
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setTypeFilter("all")}
        className="cursor-pointer"
      >
        {m.tickets_filters_all_types()}
        {typeFilter === "all" && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      {(Object.keys(TYPE_META) as TicketType[]).map((t) => {
        const TIcon = TYPE_META[t].icon
        return (
          <DropdownMenuItem
            key={t}
            closeOnClick={false}
            onClick={() => setTypeFilter(t)}
            className="cursor-pointer"
          >
            <TIcon className="size-4" strokeWidth={1.75} />
            {TYPE_LABELS[t]()}
            {typeFilter === t && (
              <Check className="ml-auto size-3.5 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )
      })}
    </FilterSection>
  )
}

function FilterAssignee({
  value,
  onChange,
  members
}: {
  value: TicketFilter["assignee"]
  onChange: (value: TicketFilter["assignee"]) => void
  members: ReadonlyArray<Member>
}) {
  const me = useAtomValue(meAtom)
  const viewerId = Result.isSuccess(me) ? me.value.id : null
  const assignees = value
  const assigneeFilter =
    assignees?.length === 1 ? (assignees[0] ?? "unassigned") : "all"
  const setAssigneeFilter = (assignee: string) =>
    onChange(
      assignee === "all"
        ? undefined
        : [assignee === "unassigned" ? null : assignee]
    )
  return (
    <FilterSection>
      <SectionLabel>{m.tickets_filters_section_assignee()}</SectionLabel>
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setAssigneeFilter("all")}
        className="cursor-pointer"
      >
        {m.tickets_filters_assignee_anyone()}
        {assigneeFilter === "all" && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      {viewerId && (
        <DropdownMenuItem
          closeOnClick={false}
          onClick={() => setAssigneeFilter("mine")}
          className="cursor-pointer"
        >
          <UserRound className="size-4" strokeWidth={1.75} />
          {m.tickets_filters_assignee_mine()}
          {assigneeFilter === "mine" && (
            <Check className="ml-auto size-3.5 text-muted-foreground" />
          )}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setAssigneeFilter("unassigned")}
        className="cursor-pointer"
      >
        {m.tickets_filters_assignee_unassigned()}
        {assigneeFilter === "unassigned" && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      {members.length > 0 && <div className="my-1 h-px bg-border" />}
      {members.map((member) => (
        <DropdownMenuItem
          key={member.id}
          closeOnClick={false}
          onClick={() => setAssigneeFilter(member.id)}
          className="cursor-pointer"
        >
          <MemberAvatar member={member} size={20} />
          <span className="truncate">{member.name}</span>
          {assigneeFilter === member.id && (
            <Check className="ml-auto size-3.5 text-muted-foreground" />
          )}
        </DropdownMenuItem>
      ))}
    </FilterSection>
  )
}

function FilterSprint({
  value,
  onChange,
  orgSlug,
  slug
}: {
  value: TicketFilter["groupId"]
  onChange: (value: TicketFilter["groupId"]) => void
  orgSlug: string
  slug: string
}) {
  const groups = value
  const sprintFilter =
    groups?.length === 1 ? (groups[0] ?? "unassigned") : "all"
  const setSprintFilter = (sprint: SprintFilterValue) =>
    onChange(
      sprint === "all" ? undefined : [sprint === "unassigned" ? null : sprint]
    )
  const sprintsList = useAtomValue(
    sprintsListAtom(sprintsProjectKey(orgSlug, slug))
  )
  const allSprints = Result.isSuccess(sprintsList) ? sprintsList.value : []
  const now = DateTime.toDate(DateTime.nowUnsafe())
  const sprintOptions = allSprints.filter((s) => {
    const st = sprintState(s, now)
    return st === "active" || st === "planned"
  })
  return (
    <FilterSection>
      <SectionLabel>{m.tickets_filters_section_sprint()}</SectionLabel>
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setSprintFilter("all")}
        className="cursor-pointer"
      >
        {m.tickets_filters_sprint_any()}
        {sprintFilter === "all" && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      <DropdownMenuItem
        closeOnClick={false}
        onClick={() => setSprintFilter("unassigned")}
        className="cursor-pointer"
      >
        {m.tickets_filters_sprint_none()}
        {sprintFilter === "unassigned" && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      {sprintOptions.length > 0 && <div className="my-1 h-px bg-border" />}
      {sprintOptions.map((s) => {
        const meta = SPRINT_STATE_META[sprintState(s, now)]
        const SIcon = meta.icon
        return (
          <DropdownMenuItem
            key={s.id}
            closeOnClick={false}
            onClick={() => setSprintFilter(s.id)}
            className="cursor-pointer"
          >
            <SIcon
              className={cn("size-4", meta.className)}
              strokeWidth={1.75}
            />
            <span className="truncate">{s.name}</span>
            {sprintFilter === s.id && (
              <Check className="ml-auto size-3.5 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )
      })}
    </FilterSection>
  )
}

function FilterTags({
  value,
  onChange,
  orgSlug,
  slug
}: {
  value: TicketFilter["tags"]
  onChange: (value: TicketFilter["tags"]) => void
  orgSlug: string
  slug: string
}) {
  const selectedTags = value ?? []
  const setSelectedTags = (tags: typeof selectedTags) =>
    onChange(tags.length ? tags : undefined)
  const tags = useAtomValue(tagsAtom(tagsKey(orgSlug, slug)))
  const tagList = Result.isSuccess(tags) ? tags.value : []
  if (tagList.length === 0) return null
  return (
    <FilterSection>
      <SectionLabel>{m.tickets_filters_section_tags()}</SectionLabel>
      <div className="flex flex-wrap gap-1 px-2 pb-1.5 pt-0.5">
        {tagList.map((tag) => {
          const selected = selectedTags.includes(tag.name)
          return (
            <button
              key={tag.name}
              type="button"
              onClick={(e) => {
                e.preventDefault()
                setSelectedTags(
                  selected
                    ? selectedTags.filter((t) => t !== tag.name)
                    : [...selectedTags, tag.name]
                )
              }}
              aria-pressed={selected}
              className="rounded-md outline-none transition-transform duration-100 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              <TagChip
                name={tag.name}
                color={tag.color ?? null}
                size="xs"
                intensity={selected ? "strong" : "soft"}
                className={cn(!selected && "opacity-60")}
              />
            </button>
          )
        })}
      </div>
    </FilterSection>
  )
}

import {
  Result,
  useAtomRefresh,
  useAtomSet,
  useAtomValue
} from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { Plus } from "lucide-react"
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react"
import { CollapsingLabel } from "@/components/SegmentedTabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { BADGE_TONES } from "@/components/ui/badge"
import { projectGitStatesBaseAtom } from "@/atoms/github"
import { projectAtom, projectKey } from "@/atoms/projects"
import {
  projectKey as sprintsKey,
  sprintsListAtom,
  useAddTicketsToSprint
} from "@/atoms/sprints"
import { meAtom } from "@/atoms/auth"
import {
  quickCreateTicketAtom,
  ticketSearchAtom,
  ticketSearchKey,
  ticketsListKeyForStatus
} from "@/atoms/tickets"
import { cn } from "@/lib/utils"
import { TYPE_LABELS, TYPE_META } from "@/lib/ticket-meta"
import { m } from "@/paraglide/messages"
import type {
  GroupId,
  Ticket,
  TicketId,
  TicketStatus,
  TicketType
} from "@projectproject/shared"
import { TicketCreatorShell } from "./TicketCreatorShell"

type Item =
  | { kind: "create"; label: string }
  | { kind: "existing"; ticket: Ticket; otherSprintName: string | null }

export function SprintTicketCreator({
  orgSlug,
  slug,
  groupId,
  excludeIds
}: {
  orgSlug: string
  slug: string
  groupId: GroupId
  excludeIds: ReadonlySet<TicketId>
}) {
  const projKey = projectKey(orgSlug, slug)
  const sprintProjectKey = sprintsKey(orgSlug, slug)
  const sectionKey = ticketsListKeyForStatus(
    orgSlug,
    slug,
    { sort: { key: "updated", dir: "desc" }, filter: { groupId: [groupId] } },
    "todo" as TicketStatus
  )

  const create = useAtomSet(quickCreateTicketAtom(sectionKey), {
    mode: "promiseExit"
  })
  const createState = useAtomValue(quickCreateTicketAtom(sectionKey))
  const submitting = createState.waiting
  const me = useAtomValue(meAtom)
  const viewerId = Result.isSuccess(me) ? me.value.id : ""
  const project = useAtomValue(projectAtom(projKey))
  const projectPrefix = Result.isSuccess(project) ? project.value.key : "T"
  const error = Result.isFailure(createState)
    ? m.tickets_create_error_fallback()
    : null
  const refreshGitStates = useAtomRefresh(projectGitStatesBaseAtom(projKey))
  const navigate = useNavigate()

  const [title, setTitle] = useState("")
  const [type, setType] = useState<TicketType>("other")
  const [focused, setFocused] = useState(false)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [closingMenu, setClosingMenu] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = title.trim()
  const expanded = focused || typeMenuOpen || closingMenu

  const ticketsResult = useAtomValue(
    ticketSearchAtom(
      ticketSearchKey(orgSlug, slug, {
        q: trimmed.length > 0 ? trimmed : undefined,
        excludeGroupId: groupId,
        limit: 24
      })
    )
  )
  const sprintsResult = useAtomValue(sprintsListAtom(sprintProjectKey))
  const addToSprint = useAddTicketsToSprint(sprintProjectKey)

  const memberOfOtherSprint = useMemo(() => {
    const map = new Map<string, string>()
    if (!Result.isSuccess(sprintsResult)) return map
    for (const s of sprintsResult.value) {
      if (s.id === groupId || s.completedAt !== null) continue
      for (const tid of s.tickets) {
        if (!map.has(tid)) map.set(tid, s.name)
      }
    }
    return map
  }, [sprintsResult, groupId])

  const items: ReadonlyArray<Item> = useMemo(() => {
    const lowered = trimmed.toLowerCase()
    const all = Result.isSuccess(ticketsResult) ? ticketsResult.value : []
    const eligible = all.filter(
      (t) => t.status !== "done" && !excludeIds.has(t.id)
    )
    const exactTitle = all.some((t) => t.title.toLowerCase() === lowered)
    const existing: Array<Item> = eligible.slice(0, 8).map((t) => ({
      kind: "existing" as const,
      ticket: t,
      otherSprintName: memberOfOtherSprint.get(t.id) ?? null
    }))
    if (trimmed.length === 0 || exactTitle) return existing
    return [{ kind: "create" as const, label: trimmed }, ...existing]
  }, [trimmed, ticketsResult, excludeIds, memberOfOtherSprint])

  const dropdownOpen = expanded && items.length > 0
  const safeHighlight = items.length === 0 ? 0 : highlight % items.length

  function reset() {
    setTitle("")
    setHighlight(0)
  }

  function openCreatedTicket(id: TicketId) {
    void navigate({
      to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      params: { orgSlug, slug, id },
      search: { focusBody: 1 }
    })
  }

  async function commit(item: Item | undefined) {
    if (!item) return
    if (item.kind === "existing") {
      addToSprint({ groupId, ticketIds: [item.ticket.id] })
      reset()
      return
    }
    if (submitting) return
    const exit = await create({
      ticket: { title: item.label, type },
      viewerId,
      projectPrefix
    })
    if (Exit.isSuccess(exit)) {
      addToSprint({ groupId, ticketIds: [exit.value.id] })
      refreshGitStates()
      reset()
      openCreatedTicket(exit.value.id)
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (items.length > 0) {
      await commit(items[safeHighlight])
      return
    }
    if (!trimmed || submitting) return
    const exit = await create({
      ticket: { title: trimmed, type },
      viewerId,
      projectPrefix
    })
    if (Exit.isSuccess(exit)) {
      addToSprint({ groupId, ticketIds: [exit.value.id] })
      refreshGitStates()
      reset()
      openCreatedTicket(exit.value.id)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!dropdownOpen) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlight((h) => (items.length ? (h + 1) % items.length : 0))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlight((h) =>
        items.length ? (h - 1 + items.length) % items.length : 0
      )
    } else if (e.key === "Escape") {
      e.preventDefault()
      inputRef.current?.blur()
    }
  }

  const TypeIcon = TYPE_META[type].icon
  const typeAddon = (
    <DropdownMenu
      open={typeMenuOpen}
      onOpenChange={(open) => {
        setTypeMenuOpen(open)
        if (!open) {
          setClosingMenu(true)
          // @effect-diagnostics-next-line globalTimers:off
          setTimeout(() => {
            inputRef.current?.focus()
            setClosingMenu(false)
          }, 0)
        }
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={m.tickets_create_type_aria_label({
              type: TYPE_LABELS[type]()
            })}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-md transition-expand",
              expanded
                ? cn("px-2", BADGE_TONES[TYPE_META[type].tone])
                : "px-1 hover:bg-accent hover:text-foreground"
            )}
          >
            <TypeIcon className="size-4 shrink-0" strokeWidth={1.75} />
            <CollapsingLabel show={expanded} contentKey={type} gap={6}>
              <span className="text-xs">{TYPE_LABELS[type]()}</span>
            </CollapsingLabel>
          </button>
        }
      />
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-40"
        finalFocus={() => {
          setClosingMenu(false)
          return inputRef.current
        }}
      >
        {(Object.keys(TYPE_META) as TicketType[]).map((t) => {
          const TIcon = TYPE_META[t].icon
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => setType(t)}
              className="cursor-pointer"
            >
              <TIcon className="size-4" strokeWidth={1.75} />
              {TYPE_LABELS[t]()}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const dropdown = dropdownOpen ? (
    <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-popover shadow-md">
      <ul className="flex max-h-72 flex-col overflow-y-auto p-1">
        {items.map((item, idx) => (
          <li key={item.kind === "create" ? "__create" : item.ticket.id}>
            {item.kind === "create" ? (
              <CreateRow
                label={item.label}
                active={idx === safeHighlight}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  void commit(item)
                }}
              />
            ) : (
              <ExistingRow
                ticket={item.ticket}
                otherSprintName={item.otherSprintName}
                active={idx === safeHighlight}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  void commit(item)
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  ) : null

  const trailing = error ? (
    <span className="shrink-0 text-xs text-destructive">{error}</span>
  ) : null

  return (
    <TicketCreatorShell
      formProps={{ "data-active": expanded || undefined }}
      inputRef={inputRef}
      value={title}
      onValueChange={(v) => {
        setTitle(v)
        setHighlight(0)
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      onSubmit={onSubmit}
      expanded={expanded}
      placeholder={m.sprints_combobox_placeholder()}
      ariaLabel={m.sprints_combobox_placeholder()}
      disabled={submitting}
      maxLength={200}
      leadingAddons={[typeAddon]}
      trailing={trailing}
      belowInput={dropdown}
    />
  )
}

function CreateRow({
  label,
  active,
  onMouseEnter,
  onMouseDown
}: {
  label: string
  active: boolean
  onMouseEnter: () => void
  onMouseDown: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseDown={onMouseDown}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground"
      )}
    >
      <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate">
        {m.sprints_combobox_create_prefix()}
        <span className="text-foreground">{label}</span>
      </span>
    </button>
  )
}

function ExistingRow({
  ticket,
  otherSprintName,
  active,
  onMouseEnter,
  onMouseDown
}: {
  ticket: Ticket
  otherSprintName: string | null
  active: boolean
  onMouseEnter: () => void
  onMouseDown: (e: React.MouseEvent) => void
}) {
  const Icon = TYPE_META[ticket.type].icon
  return (
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onMouseDown={onMouseDown}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-accent text-foreground" : "text-muted-foreground"
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="font-mono text-[11px] tabular-nums">{ticket.id}</span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {ticket.title}
      </span>
      {otherSprintName && (
        <span className="font-mono text-[10px] text-muted-foreground">
          {m.sprints_add_tickets_in_other_sprint({ name: otherSprintName })}
        </span>
      )}
    </button>
  )
}

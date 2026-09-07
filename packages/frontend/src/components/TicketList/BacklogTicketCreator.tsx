import {
  Result,
  useAtomRefresh,
  useAtomSet,
  useAtomValue
} from "@effect-atom/atom-react"
import { useNavigate } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { CollapsingLabel } from "@/components/SegmentedTabs"
import { SprintStateIcon } from "@/components/sprints/SprintChip"
import {
  pickDefaultSprint,
  SprintAssignMenu
} from "@/components/sprints/SprintAssignMenu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { BADGE_TONES } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { meAtom } from "@/atoms/auth"
import { projectGitStatesBaseAtom } from "@/atoms/github"
import { projectAtom, projectKey } from "@/atoms/projects"
import {
  projectKey as sprintsKey,
  sprintsListAtom,
  useAddTicketsToSprint
} from "@/atoms/sprints"
import { quickCreateTicketAtom, ticketsListKeyForStatus } from "@/atoms/tickets"
import { useGlobalShortcut } from "@/lib/use-global-shortcut"
import { cn } from "@/lib/utils"
import { TYPE_LABELS, TYPE_META } from "@/lib/ticket-meta"
import { m } from "@/paraglide/messages"
import type {
  Group,
  TicketListQuery,
  TicketStatus,
  TicketType
} from "@projectproject/shared"
import { TicketCreatorShell } from "./TicketCreatorShell"

export function BacklogTicketCreator({
  orgSlug,
  slug,
  query
}: {
  orgSlug: string
  slug: string
  query: TicketListQuery
}) {
  const projKey = projectKey(orgSlug, slug)
  const sectionKey = ticketsListKeyForStatus(
    orgSlug,
    slug,
    query,
    "todo" as TicketStatus
  )
  const create = useAtomSet(quickCreateTicketAtom(sectionKey), {
    mode: "promiseExit"
  })
  const createState = useAtomValue(quickCreateTicketAtom(sectionKey))
  const submitting = createState.waiting
  const error = Result.isFailure(createState)
    ? m.tickets_create_error_fallback()
    : null
  const refreshGitStates = useAtomRefresh(projectGitStatesBaseAtom(projKey))
  const navigate = useNavigate()

  const me = useAtomValue(meAtom)
  const viewerId = Result.isSuccess(me) ? me.value.id : ""

  const project = useAtomValue(projectAtom(projKey))
  const projectPrefix = Result.isSuccess(project) ? project.value.key : "T"

  const sprintListResult = useAtomValue(
    sprintsListAtom(sprintsKey(orgSlug, slug))
  )
  const sprints = useMemo<ReadonlyArray<Group>>(
    () => (Result.isSuccess(sprintListResult) ? sprintListResult.value : []),
    [sprintListResult]
  )
  const hasSprints = sprints.some((s) => s.completedAt === null)
  const addToSprint = useAddTicketsToSprint(sprintsKey(orgSlug, slug))

  const [title, setTitle] = useState("")
  const [type, setType] = useState<TicketType>("other")
  const [selectedSprint, setSelectedSprint] = useState<Group | null>(null)
  const [sprintCleared, setSprintCleared] = useState(false)
  const [focused, setFocused] = useState(false)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [sprintMenuOpen, setSprintMenuOpen] = useState(false)
  const [closingMenu, setClosingMenu] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useGlobalShortcut("c", inputRef)
  const trimmed = title.trim()
  const expanded = focused || typeMenuOpen || sprintMenuOpen || closingMenu

  useEffect(() => {
    if (selectedSprint || sprintCleared) return
    const def = pickDefaultSprint(sprints)
    if (def) setSelectedSprint(def)
  }, [sprints, selectedSprint, sprintCleared])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!trimmed || submitting) return
    inputRef.current?.blur()
    setFocused(false)
    const exit = await create({
      ticket: { title: trimmed, type },
      viewerId,
      projectPrefix
    })
    if (Exit.isSuccess(exit)) {
      const ticket = exit.value
      if (selectedSprint) {
        addToSprint({ groupId: selectedSprint.id, ticketIds: [ticket.id] })
      }
      setTitle("")
      refreshGitStates()
      void navigate({
        to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
        params: { orgSlug, slug, id: ticket.id },
        search: { focusBody: 1 }
      })
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

  const sprintAddon = hasSprints ? (
    <SprintAssignMenu
      open={sprintMenuOpen}
      onOpenChange={(open) => {
        setSprintMenuOpen(open)
        if (!open) setClosingMenu(true)
      }}
      finalFocus={() => {
        setClosingMenu(false)
        return inputRef.current
      }}
      sprints={sprints}
      selectedId={selectedSprint?.id ?? null}
      onSelect={(s) => {
        setSelectedSprint(s)
        setSprintCleared(false)
      }}
      onClear={() => {
        setSelectedSprint(null)
        setSprintCleared(true)
      }}
      clearLabel={m.tickets_sprint_popover_no_assignment_action()}
      trigger={
        <button
          type="button"
          aria-label={
            selectedSprint
              ? m.tickets_sprint_chip_aria({ name: selectedSprint.name })
              : m.tickets_assign_sprint_chip()
          }
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md transition-expand",
            expanded
              ? cn("px-2", BADGE_TONES.muted)
              : "px-1 hover:bg-accent hover:text-foreground"
          )}
        >
          {selectedSprint ? (
            <SprintStateIcon sprint={selectedSprint} size="md" />
          ) : (
            <Plus className="size-4 shrink-0" strokeWidth={1.75} />
          )}
          <CollapsingLabel
            show={expanded}
            contentKey={selectedSprint?.id ?? "none"}
            gap={6}
          >
            <span className="max-w-[10ch] truncate text-xs">
              {selectedSprint
                ? selectedSprint.name
                : m.tickets_assign_sprint_chip()}
            </span>
          </CollapsingLabel>
        </button>
      }
    />
  ) : null

  const trailing = (
    <>
      {error && (
        <span className="shrink-0 text-xs text-destructive">{error}</span>
      )}
      {!expanded && !error && <Kbd>c</Kbd>}
    </>
  )

  return (
    <TicketCreatorShell
      formProps={{ "data-active": expanded || undefined }}
      inputRef={inputRef}
      value={title}
      onValueChange={setTitle}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onSubmit={onSubmit}
      expanded={expanded}
      placeholder={m.tickets_create_title_placeholder()}
      ariaLabel={m.tickets_create_title_aria_label()}
      disabled={submitting}
      maxLength={200}
      leadingAddons={sprintAddon ? [typeAddon, sprintAddon] : [typeAddon]}
      trailing={trailing}
    />
  )
}

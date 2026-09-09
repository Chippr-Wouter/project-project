import { useAtomSet } from "@effect/atom-react"
import { Check, UserRound } from "lucide-react"
import { createContext, use, useMemo, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Hitbox } from "@/components/ui/hitbox"
import { AvatarStack, MemberAvatar } from "@/components/MemberAvatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { m } from "@/paraglide/messages"
import { ticketKey, updateTicketAtom } from "@/atoms/tickets"
import type { Member, TicketId } from "@projectproject/shared"

export function resolveAssignees(
  assignees: ReadonlyArray<string>,
  members: ReadonlyArray<Member>
): ReadonlyArray<Member> {
  return assignees
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => !!member)
}

type AssigneeContextValue = {
  state: {
    assignees: ReadonlyArray<string>
    resolved: ReadonlyArray<Member>
  }
  actions: {
    toggle: (memberId: string) => void
    clear: () => void
  }
  meta: {
    members: ReadonlyArray<Member>
  }
}

const AssigneeContext = createContext<AssigneeContextValue | null>(null)

export function useAssignees(): AssigneeContextValue {
  const value = use(AssigneeContext)
  if (!value) throw new Error("useAssignees must be used within Assignee.Root")
  return value
}

function Root({
  orgSlug,
  slug,
  ticket,
  members,
  children
}: {
  orgSlug: string
  slug: string
  ticket: { id: TicketId; assignees: ReadonlyArray<string> }
  members: ReadonlyArray<Member>
  children: ReactNode
}) {
  const update = useAtomSet(
    updateTicketAtom(ticketKey(orgSlug, slug, ticket.id))
  )
  const assignees = ticket.assignees
  const value = useMemo<AssigneeContextValue>(() => {
    const setAssignees = (next: ReadonlyArray<string>) => {
      update({ assignees: next })
    }
    return {
      state: { assignees, resolved: resolveAssignees(assignees, members) },
      actions: {
        toggle: (memberId) =>
          setAssignees(
            assignees.includes(memberId)
              ? assignees.filter((a) => a !== memberId)
              : [...assignees, memberId]
          ),
        clear: () => {
          if (assignees.length > 0) setAssignees([])
        }
      },
      meta: { members }
    }
  }, [assignees, members, update])
  return (
    <AssigneeContext value={value}>
      <DropdownMenu>{children}</DropdownMenu>
    </AssigneeContext>
  )
}

function Trigger({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <DropdownMenuTrigger
      render={
        <Hitbox
          mode="inline"
          margin="2"
          onClick={(e) => e.stopPropagation()}
          aria-label={label}
          className={className}
        >
          {children}
        </Hitbox>
      }
    />
  )
}

function ChipTrigger({
  label,
  children
}: {
  label: string
  children: ReactNode
}) {
  return (
    <DropdownMenuTrigger
      render={
        <Button type="button" variant="chip" aria-label={label}>
          {children}
        </Button>
      }
    />
  )
}

function Avatars({ size = 20 }: { size?: number }) {
  const {
    state: { resolved }
  } = useAssignees()
  if (resolved.length === 0) return null
  if (resolved.length === 1) {
    return <MemberAvatar member={resolved[0]} size={size} />
  }
  return <AvatarStack subjects={resolved} size={size} max={3} />
}

function Empty({ children }: { children: ReactNode }) {
  const {
    state: { resolved }
  } = useAssignees()
  if (resolved.length > 0) return null
  return children
}

function Content() {
  const {
    state: { assignees },
    actions: { toggle, clear },
    meta: { members }
  } = useAssignees()
  return (
    <DropdownMenuContent
      align="start"
      sideOffset={6}
      className="w-56"
      onClick={(e) => e.stopPropagation()}
      finalFocus={false}
    >
      <DropdownMenuItem
        closeOnClick={false}
        onClick={clear}
        className="cursor-pointer"
      >
        <UserRound className="size-4" strokeWidth={1.75} />
        {m.tickets_assignee_unassigned()}
        {assignees.length === 0 && (
          <Check className="ml-auto size-3.5 text-muted-foreground" />
        )}
      </DropdownMenuItem>
      {members.length > 0 && <div className="my-1 h-px bg-border" />}
      {members.map((member) => {
        const selected = assignees.includes(member.id)
        return (
          <DropdownMenuItem
            key={member.id}
            closeOnClick={false}
            onClick={() => toggle(member.id)}
            className="cursor-pointer"
          >
            <MemberAvatar member={member} size={20} />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm">{member.name}</div>
              {member.username && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  @{member.username}
                </div>
              )}
            </div>
            {selected && (
              <Check className="ml-auto size-3.5 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )
      })}
    </DropdownMenuContent>
  )
}

export const Assignee = {
  Root,
  Trigger,
  ChipTrigger,
  Avatars,
  Empty,
  Content
}

export function assigneeRowLabel(resolved: ReadonlyArray<Member>): string {
  return resolved.length === 0
    ? m.tickets_assignees_row_unassigned_aria_label()
    : resolved.length === 1
      ? m.tickets_assignees_row_one_aria_label({ name: resolved[0].name })
      : m.tickets_assignees_row_many_aria_label({ count: resolved.length })
}

export function assigneePickerLabel(resolved: ReadonlyArray<Member>): string {
  return resolved.length === 0
    ? m.tickets_assignee_unassigned()
    : resolved.length === 1
      ? resolved[0].name
      : m.tickets_assignee_count({ count: resolved.length })
}

export function AssigneePicker({
  orgSlug,
  slug,
  ticket,
  members
}: {
  orgSlug: string
  slug: string
  ticket: { id: TicketId; assignees: ReadonlyArray<string> }
  members: ReadonlyArray<Member>
}) {
  const label = assigneePickerLabel(resolveAssignees(ticket.assignees, members))
  return (
    <Assignee.Root
      orgSlug={orgSlug}
      slug={slug}
      ticket={ticket}
      members={members}
    >
      <Assignee.ChipTrigger label={m.tickets_assignees_aria_label({ label })}>
        <Assignee.Empty>
          <UserRound className="size-3.5" strokeWidth={1.75} />
        </Assignee.Empty>
        <Assignee.Avatars size={18} />
        <span>{label}</span>
      </Assignee.ChipTrigger>
      <Assignee.Content />
    </Assignee.Root>
  )
}

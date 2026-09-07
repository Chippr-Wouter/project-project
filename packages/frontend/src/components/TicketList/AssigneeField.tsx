import { useAtomSet } from "@effect/atom-react"
import { Check, UserRound } from "lucide-react"
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

function AssigneeMenuContent({
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
  const update = useAtomSet(
    updateTicketAtom(ticketKey(orgSlug, slug, ticket.id))
  )
  const assignees = ticket.assignees
  const setAssignees = (next: ReadonlyArray<string>) => {
    update({ assignees: next })
  }
  const toggle = (id: string) => {
    setAssignees(
      assignees.includes(id)
        ? assignees.filter((a) => a !== id)
        : [...assignees, id]
    )
  }
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
        onClick={() => {
          if (assignees.length > 0) setAssignees([])
        }}
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
  const resolved = ticket.assignees
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => !!member)
  const label =
    resolved.length === 0
      ? m.tickets_assignee_unassigned()
      : resolved.length === 1
        ? resolved[0].name
        : m.tickets_assignee_count({ count: resolved.length })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="chip"
            aria-label={m.tickets_assignees_aria_label({ label })}
          >
            {resolved.length === 0 ? (
              <UserRound className="size-3.5" strokeWidth={1.75} />
            ) : resolved.length === 1 ? (
              <MemberAvatar member={resolved[0]} size={18} />
            ) : (
              <AvatarStack subjects={resolved} size={18} max={3} />
            )}
            <span>{label}</span>
          </Button>
        }
      />
      <AssigneeMenuContent
        orgSlug={orgSlug}
        slug={slug}
        ticket={ticket}
        members={members}
      />
    </DropdownMenu>
  )
}

export function AssigneeRowTrigger({
  orgSlug,
  slug,
  ticket,
  members,
  className
}: {
  orgSlug: string
  slug: string
  ticket: { id: TicketId; assignees: ReadonlyArray<string> }
  members: ReadonlyArray<Member>
  className?: string
}) {
  const resolved = ticket.assignees
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => !!member)
  const label =
    resolved.length === 0
      ? m.tickets_assignees_row_unassigned_aria_label()
      : resolved.length === 1
        ? m.tickets_assignees_row_one_aria_label({ name: resolved[0].name })
        : m.tickets_assignees_row_many_aria_label({ count: resolved.length })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Hitbox
            mode="inline"
            margin="2"
            onClick={(e) => e.stopPropagation()}
            aria-label={label}
            className={className}
          >
            <span className="inline-flex items-center text-muted-foreground transition-colors group-hover/hitbox:text-foreground">
              {resolved.length === 0 ? (
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted">
                  <UserRound className="size-3" strokeWidth={1.75} />
                </span>
              ) : resolved.length === 1 ? (
                <MemberAvatar member={resolved[0]} size={20} />
              ) : (
                <AvatarStack subjects={resolved} size={20} max={3} />
              )}
            </span>
          </Hitbox>
        }
      />
      <AssigneeMenuContent
        orgSlug={orgSlug}
        slug={slug}
        ticket={ticket}
        members={members}
      />
    </DropdownMenu>
  )
}

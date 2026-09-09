import { memo } from "react"
import { DeferredDropdownMenus } from "@/components/ui/dropdown-menu"
import { Link } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import {
  applyOptimisticTicketPreview,
  ticketKey,
  ticketUpdatePreviewAtom
} from "@/atoms/tickets"
import { TicketGitChip } from "@/components/TicketGit"
import { cn } from "@/lib/utils"
import type { Member, Ticket } from "@projectproject/shared"
import { UserRound } from "lucide-react"
import {
  Assignee,
  assigneeRowLabel,
  resolveAssignees
} from "@/components/TicketList/AssigneeField"
import { PriorityButton } from "@/components/TicketList/PriorityField"
import { TypeButton } from "@/components/TicketList/TypeField"

function SprintBoardCardImpl({
  orgSlug,
  slug,
  sprintTicketsKey,
  ticket,
  members
}: {
  orgSlug: string
  slug: string
  sprintTicketsKey: string
  ticket: Ticket
  members: ReadonlyArray<Member>
}) {
  const updatePreview = useAtomValue(
    ticketUpdatePreviewAtom(ticketKey(orgSlug, slug, ticket.id))
  )
  const visibleTicket = applyOptimisticTicketPreview(
    ticket,
    updatePreview.input
  )
  const resolvedAssignees = resolveAssignees(visibleTicket.assignees, members)

  return (
    <DeferredDropdownMenus>
      <div
        className={cn(
          "group/card relative isolate flex flex-col gap-2 rounded-sm bg-card px-1.5 pt-3 pb-1.5 text-left outline-none transition-colors duration-100 hover:bg-muted [&_button]:relative [&_button]:z-20 [&_a:not([data-row-link])]:relative [&_a:not([data-row-link])]:z-20",
          updatePreview.waiting && "animate-pulse"
        )}
      >
        <div className="flex min-h-[2lh] items-start gap-1.5 text-[13px] leading-snug">
          <Link
            to="/orgs/$orgSlug/projects/$slug/tickets/$id"
            params={{ orgSlug, slug, id: visibleTicket.id }}
            preload="intent"
            data-row-link
            className="min-w-0 font-medium outline-none after:absolute after:inset-0 after:z-10 after:rounded-sm after:content-[''] focus-visible:after:ring-1 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            <span className="line-clamp-2">{visibleTicket.title}</span>
          </Link>
          <div className="order-first mt-[calc((1lh-1.5rem)/2)] shrink-0">
            <TypeButton
              orgSlug={orgSlug}
              slug={slug}
              ticket={visibleTicket}
              iconOnly
              sprintTicketsKey={sprintTicketsKey}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PriorityButton
            sprintTicketsKey={sprintTicketsKey}
            orgSlug={orgSlug}
            slug={slug}
            ticket={visibleTicket}
            stopPropagation
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {visibleTicket.id}
          </span>
          <div className="flex min-w-0 flex-1 items-center">
            <TicketGitChip
              orgSlug={orgSlug}
              slug={slug}
              ticket={visibleTicket}
            />
          </div>
          <Assignee.Root
            orgSlug={orgSlug}
            slug={slug}
            ticket={visibleTicket}
            members={members}
          >
            <Assignee.Trigger
              label={assigneeRowLabel(resolvedAssignees)}
              className={cn(
                "transition-opacity",
                resolvedAssignees.length === 0 &&
                  "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
              )}
            >
              <Assignee.Empty>
                <span className="grid size-6 place-items-center rounded-full text-muted-foreground transition-colors group-hover/hitbox:bg-foreground/5 group-hover/hitbox:text-foreground">
                  <UserRound className="size-4" strokeWidth={1.75} />
                </span>
              </Assignee.Empty>
              <Assignee.Avatars />
            </Assignee.Trigger>
            <Assignee.Content />
          </Assignee.Root>
        </div>
      </div>
    </DeferredDropdownMenus>
  )
}

export const SprintBoardCard = memo(SprintBoardCardImpl)

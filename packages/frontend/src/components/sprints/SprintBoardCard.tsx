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
import { AssigneeRowTrigger } from "@/components/TicketList/AssigneeField"
import { PriorityButton } from "@/components/TicketList/PriorityField"
import { TypeButton } from "@/components/TicketList/TypeField"

function SprintBoardCardImpl({
  orgSlug,
  slug,
  ticket,
  members
}: {
  orgSlug: string
  slug: string
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

  return (
    <DeferredDropdownMenus>
      <div
        className={cn(
          "group/card relative isolate flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-left outline-none transition-colors duration-100 hover:bg-accent/30 [&_button]:relative [&_button]:z-20 [&_a:not([data-row-link])]:relative [&_a:not([data-row-link])]:z-20",
          updatePreview.waiting && "animate-pulse"
        )}
      >
        <div className="flex items-start gap-1.5 text-sm leading-snug">
          <Link
            to="/orgs/$orgSlug/projects/$slug/tickets/$id"
            params={{ orgSlug, slug, id: visibleTicket.id }}
            preload="intent"
            data-row-link
            className="min-w-0 font-medium outline-none after:absolute after:inset-0 after:z-10 after:rounded-md after:content-[''] focus-visible:after:ring-1 focus-visible:after:ring-ring focus-visible:after:ring-inset"
          >
            <span className="line-clamp-2">{visibleTicket.title}</span>
          </Link>
          <div className="order-first -mt-[1.5px] grid h-[1lh] shrink-0 place-items-center">
            <TypeButton
              orgSlug={orgSlug}
              slug={slug}
              ticket={visibleTicket}
              iconOnly
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PriorityButton
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
          <AssigneeRowTrigger
            orgSlug={orgSlug}
            slug={slug}
            ticket={visibleTicket}
            members={members}
            className={cn(
              "transition-opacity",
              visibleTicket.assignees.length === 0 &&
                "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
            )}
          />
        </div>
      </div>
    </DeferredDropdownMenus>
  )
}

export const SprintBoardCard = memo(SprintBoardCardImpl)

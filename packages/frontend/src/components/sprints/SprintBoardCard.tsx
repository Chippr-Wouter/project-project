import { memo, useMemo, type HTMLAttributes } from "react"
import { DeferredDropdownMenus } from "@/components/ui/dropdown-menu"
import { useLinkProps, useNavigate } from "@tanstack/react-router"
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
  const navigate = useNavigate()
  const linkParams = useMemo(
    () => ({ orgSlug, slug, id: visibleTicket.id }),
    [orgSlug, slug, visibleTicket.id]
  )
  const { onMouseEnter, onMouseLeave, onFocus, onBlur, onTouchStart } =
    useLinkProps({
      to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      params: linkParams,
      preload: "intent"
    })
  const preload: HTMLAttributes<HTMLElement> = {
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onTouchStart
  }
  const open = () => {
    void navigate({
      to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      params: { orgSlug, slug, id: visibleTicket.id }
    })
  }

  return (
    <DeferredDropdownMenus>
      <div
        {...preload}
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            open()
          }
        }}
        className={cn(
          "group/card flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-background p-3 text-left outline-none transition-colors duration-100 hover:bg-accent/30 focus-visible:ring-1 focus-visible:ring-ring",
          updatePreview.waiting && "animate-pulse"
        )}
      >
        <div className="flex items-start gap-1.5 text-sm leading-snug">
          <div className="-mt-[1.5px] grid h-[1lh] shrink-0 place-items-center">
            <TypeButton
              orgSlug={orgSlug}
              slug={slug}
              ticket={visibleTicket}
              iconOnly
            />
          </div>
          <span className="line-clamp-2 min-w-0 font-medium">
            {visibleTicket.title}
          </span>
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

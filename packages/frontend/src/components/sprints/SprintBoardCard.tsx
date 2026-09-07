import { DeferredDropdownMenus } from "@/components/ui/dropdown-menu"
import { memo } from "react"
import { useNavigate } from "@tanstack/react-router"
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
  const navigate = useNavigate()
  const open = () => {
    void navigate({
      to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      params: { orgSlug, slug, id: ticket.id }
    })
  }

  return (
    <DeferredDropdownMenus>
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            open()
          }
        }}
        className="group/card flex cursor-pointer flex-col gap-2 rounded-md border border-border bg-background p-3 text-left outline-none transition-colors duration-100 hover:bg-accent/30 focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex items-start gap-1.5 text-sm leading-snug">
          <div className="-mt-[1.5px] grid h-[1lh] shrink-0 place-items-center">
            <TypeButton
              orgSlug={orgSlug}
              slug={slug}
              ticket={ticket}
              iconOnly
            />
          </div>
          <span className="line-clamp-2 min-w-0 font-medium">
            {ticket.title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <PriorityButton
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            stopPropagation
          />
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {ticket.id}
          </span>
          <div className="flex min-w-0 flex-1 items-center">
            <TicketGitChip orgSlug={orgSlug} slug={slug} ticket={ticket} />
          </div>
          <AssigneeRowTrigger
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            members={members}
            className={cn(
              "transition-opacity",
              ticket.assignees.length === 0 &&
                "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
            )}
          />
        </div>
      </div>
    </DeferredDropdownMenus>
  )
}

export const SprintBoardCard = memo(SprintBoardCardImpl)

import {
  memo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode
} from "react"
import { AnimatePresence, motion } from "motion/react"
import { useNavigate } from "@tanstack/react-router"
import { TicketGitChip } from "@/components/TicketGit"
import { TicketHoverCard } from "@/components/TicketHoverCard"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import type {
  Group,
  Member,
  Ticket,
  TicketListQuery
} from "@projectproject/shared"
import { AssigneeRowTrigger } from "./AssigneeField"
import { PriorityButton } from "./PriorityField"
import { SprintField } from "./SprintField"
import { StatusButton } from "./StatusField"
import { TypeButton } from "./TypeField"

const TICKET_PREVIEW_DELAY_MS = 400

function RowImpl({
  orgSlug,
  slug,
  ticket,
  query,
  members,
  showSprintCol,
  showExtraActionsCol,
  sprintMembership,
  extraRowActions,
  pending,
  activePreviewId,
  onPreviewOpenChange
}: {
  orgSlug: string
  slug: string
  ticket: Ticket
  query: TicketListQuery
  members: ReadonlyArray<Member>
  showSprintCol: boolean
  showExtraActionsCol: boolean
  sprintMembership: Group | null
  extraRowActions?: (ticket: Ticket) => ReactNode
  pending?: boolean
  activePreviewId: Ticket["id"] | null
  onPreviewOpenChange: (ticketId: Ticket["id"], open: boolean) => void
}) {
  const dashIdx = ticket.id.lastIndexOf("-")
  const idPrefix = dashIdx >= 0 ? ticket.id.slice(0, dashIdx) : ticket.id
  const idTail = dashIdx >= 0 ? ticket.id.slice(dashIdx + 1) : ""
  const rowElement = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const open = () => {
    void navigate({
      to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      params: { orgSlug, slug, id: ticket.id }
    })
  }
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (isInteractiveTarget(e.target, e.currentTarget)) return
    open()
  }
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter") return
    if (isInteractiveTarget(e.target, e.currentTarget)) return
    e.preventDefault()
    open()
  }
  const handleTitlePointerEnter = () => {
    if (activePreviewId !== null && activePreviewId !== ticket.id) {
      onPreviewOpenChange(activePreviewId, false)
    }
  }
  const handleTitlePointerLeave = () => {
    onPreviewOpenChange(ticket.id, false)
  }
  return (
    <div className="group/list-row col-span-full grid grid-cols-subgrid">
      <Popover
        open={activePreviewId === ticket.id}
        onOpenChange={(open) => onPreviewOpenChange(ticket.id, open)}
      >
        <div
          ref={rowElement}
          role="link"
          tabIndex={0}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className={cn(
            "col-span-full grid cursor-pointer grid-cols-subgrid items-center gap-3 rounded-lg px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <StatusButton
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            query={query}
            stopPropagation
          />
          <PriorityButton
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            stopPropagation
          />
          <span className="inline-flex shrink-0 items-center font-mono text-xs text-muted-foreground tabular-nums">
            <span>{idPrefix}-</span>
            <AnimatePresence initial={false} mode="popLayout">
              {!pending && (
                <motion.span
                  key={idTail}
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: "blur(4px)" }}
                  transition={transitions.presence}
                  className="inline-block"
                >
                  {idTail}
                </motion.span>
              )}
            </AnimatePresence>
          </span>
          <div className="flex min-w-0 items-center">
            <PopoverTrigger
              openOnHover
              delay={TICKET_PREVIEW_DELAY_MS}
              nativeButton={false}
              render={(triggerProps) => (
                <div
                  {...triggerProps}
                  role={undefined}
                  tabIndex={undefined}
                  aria-controls={undefined}
                  aria-expanded={undefined}
                  aria-haspopup={undefined}
                  onClick={undefined}
                  onKeyDown={undefined}
                  onKeyUp={undefined}
                  onPointerDown={undefined}
                  onPointerEnter={handleTitlePointerEnter}
                  onPointerLeave={handleTitlePointerLeave}
                  className="flex min-w-0 flex-1 self-stretch items-center"
                />
              )}
            >
              <span className="min-w-0 truncate text-sm font-medium">
                {ticket.title}
              </span>
            </PopoverTrigger>
            <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
              <TicketGitChip orgSlug={orgSlug} slug={slug} ticket={ticket} />
              {showSprintCol && (
                <SprintField
                  orgSlug={orgSlug}
                  slug={slug}
                  ticketId={ticket.id}
                  membership={sprintMembership}
                />
              )}
              <AssigneeRowTrigger
                orgSlug={orgSlug}
                slug={slug}
                ticket={ticket}
                members={members}
                className="hidden sm:inline-flex"
              />
            </div>
          </div>
          <TypeButton
            orgSlug={orgSlug}
            slug={slug}
            ticket={ticket}
            className="hidden sm:inline-flex"
          />
          {showExtraActionsCol && (
            <span
              className="inline-flex shrink-0 items-center"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            >
              {extraRowActions?.(ticket)}
            </span>
          )}
        </div>
        <TicketHoverCard
          ticketId={ticket.id}
          scope={{ orgSlug, slug, members }}
          anchor={rowElement}
          interactive={false}
        />
      </Popover>
    </div>
  )
}

function isInteractiveTarget(
  target: EventTarget,
  row: HTMLDivElement
): boolean {
  if (!(target instanceof Element)) return false
  const interactive = target.closest(
    "a,button,input,select,textarea,[role='button'],[role='menuitem']"
  )
  return interactive !== null && row.contains(interactive)
}

export const Row = memo(RowImpl)

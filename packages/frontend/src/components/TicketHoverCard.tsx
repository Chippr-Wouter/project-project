import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { ticketAtom, ticketKey } from "@/atoms/tickets"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { Markdown } from "@/components/Markdown"
import { MemberAvatar } from "@/components/MemberAvatar"
import { TicketGitChip } from "@/components/TicketGit"
import { PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { PRIORITY_LABELS, PRIORITY_META } from "@/lib/priority-meta"
import {
  statusMetaFor,
  statusLabelFor,
  TYPE_LABELS,
  TYPE_META
} from "@/lib/ticket-meta"
import { m } from "@/paraglide/messages"
import type {
  Member,
  ProjectStatus,
  TicketId,
  TicketPriority,
  TicketStatus,
  TicketType
} from "@projectproject/shared"

const EMPTY_STATUSES: ReadonlyArray<ProjectStatus> = []

type TicketHoverCardScope = {
  readonly orgSlug: string
  readonly slug: string
  readonly members?: ReadonlyArray<Member>
}

const TicketHoverCardError = () => (
  <div className="text-xs text-muted-foreground">
    {m.tickets_mention_card_not_available()}
  </div>
)

export function TicketHoverCard({
  ticketId,
  scope
}: {
  ticketId: TicketId
  scope: TicketHoverCardScope
}) {
  const result = useAtomValue(
    ticketAtom(ticketKey(scope.orgSlug, scope.slug, ticketId))
  )
  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(scope.orgSlug, scope.slug))
  )
  const statuses: ReadonlyArray<ProjectStatus> = Result.isSuccess(
    statusesResult
  )
    ? statusesResult.value
    : EMPTY_STATUSES

  return (
    <PopoverContent className="w-80" align="start">
      {Result.matchWithError(result, {
        onInitial: () => <CardSkeleton />,
        onError: () => <TicketHoverCardError />,
        onDefect: () => <TicketHoverCardError />,
        onSuccess: ({ value: ticket }) => {
          const body = ticket.body.trim()
          const isOverflowing = body.split("\n").length > 6 || body.length > 320
          return (
            <div className="space-y-2">
              <div className="line-clamp-2 text-sm font-medium leading-snug">
                {ticket.title}
              </div>
              <MetaRow ticket={ticket} scope={scope} statuses={statuses} />
              {body.length > 0 && (
                <div className="relative">
                  <Markdown className="line-clamp-6 text-xs leading-relaxed text-muted-foreground [&_*]:!my-0 [&_pre]:!my-1">
                    {body}
                  </Markdown>
                  {isOverflowing && (
                    <>
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-popover via-popover/90 to-transparent"
                      />
                      <Link
                        to="/orgs/$orgSlug/projects/$slug/tickets/$id"
                        params={{
                          orgSlug: scope.orgSlug,
                          slug: scope.slug,
                          id: ticketId
                        }}
                        className="absolute bottom-0 right-0 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {m.tickets_mention_card_read_more()} →
                      </Link>
                    </>
                  )}
                </div>
              )}
              {ticket.branch && (
                <div>
                  <TicketGitChip
                    orgSlug={scope.orgSlug}
                    slug={scope.slug}
                    ticket={ticket}
                  />
                </div>
              )}
            </div>
          )
        }
      })}
    </PopoverContent>
  )
}

function MetaRow({
  ticket,
  scope,
  statuses
}: {
  ticket: {
    status: TicketStatus
    type: TicketType
    priority: TicketPriority
    assignees: ReadonlyArray<string>
  }
  scope: TicketHoverCardScope
  statuses: ReadonlyArray<ProjectStatus>
}) {
  const statusMeta = statusMetaFor(ticket.status, statuses)
  const type = TYPE_META[ticket.type]
  const priority = PRIORITY_META[ticket.priority]
  const StatusIcon = statusMeta.icon
  const TypeIcon = type.icon
  const PriorityIcon = priority.icon
  const visibleAssignees: Member[] = scope.members
    ? ticket.assignees
        .map((id) => scope.members?.find((member) => member.id === id))
        .filter((member): member is Member => !!member)
        .slice(0, 3)
    : []
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <StatusIcon
          className={cn("size-3.5", statusMeta.className)}
          style={statusMeta.color ? { color: statusMeta.color } : undefined}
          strokeWidth={1.75}
        />
        <span>{statusLabelFor(ticket.status, statuses)}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <TypeIcon className="size-3.5" strokeWidth={1.75} />
        <span>{TYPE_LABELS[ticket.type]()}</span>
      </span>
      <span className="inline-flex items-center gap-1">
        <PriorityIcon
          className={cn("size-3.5", priority.className)}
          strokeWidth={1.75}
        />
        <span>{PRIORITY_LABELS[ticket.priority]()}</span>
      </span>
      {visibleAssignees.length > 0 && (
        <span className="ml-auto inline-flex items-center gap-1">
          {visibleAssignees.map((member) => (
            <MemberAvatar key={member.id} member={member} size={16} />
          ))}
        </span>
      )}
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-3/4 rounded bg-muted" />
      <div className="h-3 w-1/2 rounded bg-muted" />
    </div>
  )
}

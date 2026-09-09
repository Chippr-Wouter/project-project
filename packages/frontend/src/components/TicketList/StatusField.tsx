import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { ArrowRight, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hitbox } from "@/components/ui/hitbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { statusMetaFor, statusLabelFor } from "@/lib/ticket-meta"
import { m } from "@/paraglide/messages"
import {
  pendingTicketStatusChangesAtom,
  ticketKey,
  ticketsCountKey,
  ticketsListKeyForStatus,
  updateTicketStatusAtom
} from "@/atoms/tickets"
import { projectKey } from "@/atoms/projects"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { boardStatusesFor } from "@/components/sprints/board-utils"
import { cn } from "@/lib/utils"
import type {
  ProjectStatus,
  Ticket,
  TicketListQuery,
  TicketStatus
} from "@projectproject/shared"

function StatusMenuItems({
  orgSlug,
  slug,
  current,
  statuses,
  onSelect
}: {
  orgSlug: string
  slug: string
  current: string
  statuses: ReadonlyArray<ProjectStatus>
  onSelect: (next: TicketStatus) => void
}) {
  const slugs = boardStatusesFor(statuses)
  return (
    <>
      {slugs.map((status) => {
        const sMeta = statusMetaFor(status, statuses)
        const SIcon = sMeta.icon
        return (
          <DropdownMenuItem
            key={status}
            onClick={() => {
              if (status === current) return
              onSelect(status as TicketStatus)
            }}
            className="cursor-pointer"
          >
            <SIcon
              className={cn("size-4", sMeta.className)}
              style={sMeta.color ? { color: sMeta.color } : undefined}
              strokeWidth={1.75}
            />
            {sMeta.label}
            {status === current && (
              <Check className="ml-auto size-3.5 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem
        render={
          <Link
            to="/orgs/$orgSlug/projects/$slug/settings/workflow"
            params={{ orgSlug, slug }}
            className="cursor-pointer"
          />
        }
      >
        {m.tickets_status_manage_link()}
        <ArrowRight className="ml-auto size-3.5" />
      </DropdownMenuItem>
    </>
  )
}

export function StatusBadgeTrigger({
  orgSlug,
  slug,
  ticket,
  query,
  className
}: {
  orgSlug: string
  slug: string
  ticket: Ticket
  query: TicketListQuery
  className?: string
}) {
  const key = ticketKey(orgSlug, slug, ticket.id)
  const update = useAtomSet(updateTicketStatusAtom(key))
  const updateState = useAtomValue(updateTicketStatusAtom(key))
  const pending = useAtomValue(
    pendingTicketStatusChangesAtom(projectKey(orgSlug, slug))
  )
  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const statuses = Result.isSuccess(statusesResult) ? statusesResult.value : []
  const currentStatus = pending.get(ticket.id)?.status ?? ticket.status
  const currentTicket = { ...ticket, status: currentStatus }
  const meta = statusMetaFor(currentStatus, statuses)
  const Icon = meta.icon
  const statusLabel = statusLabelFor(currentStatus, statuses)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="chip"
            onClick={(e) => e.stopPropagation()}
            aria-label={m.tickets_status_aria_label({ label: statusLabel })}
            className={className}
            disabled={updateState.waiting}
          >
            <Icon
              className={cn("size-3.5", meta.className)}
              style={meta.color ? { color: meta.color } : undefined}
              strokeWidth={1.75}
            />
            <span>{statusLabel}</span>
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-44"
        finalFocus={false}
        onClick={(e) => e.stopPropagation()}
      >
        <StatusMenuItems
          orgSlug={orgSlug}
          slug={slug}
          current={currentStatus}
          statuses={statuses}
          onSelect={(status) =>
            update({
              ticket: currentTicket,
              status,
              sourceSectionKey: ticketsListKeyForStatus(
                orgSlug,
                slug,
                query,
                currentStatus
              ),
              destSectionKey: ticketsListKeyForStatus(
                orgSlug,
                slug,
                query,
                status
              ),
              countKey: ticketsCountKey(orgSlug, slug, {
                filter: query.filter,
                q: query.q
              })
            })
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StatusButton({
  orgSlug,
  slug,
  ticket,
  query,
  stopPropagation,
  size = "sm"
}: {
  orgSlug: string
  slug: string
  ticket: Ticket
  query: TicketListQuery
  stopPropagation?: boolean
  size?: "sm" | "lg"
}) {
  const key = ticketKey(orgSlug, slug, ticket.id)
  const update = useAtomSet(updateTicketStatusAtom(key))
  const updateState = useAtomValue(updateTicketStatusAtom(key))
  const pending = useAtomValue(
    pendingTicketStatusChangesAtom(projectKey(orgSlug, slug))
  )
  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const statuses = Result.isSuccess(statusesResult) ? statusesResult.value : []
  const currentStatus = pending.get(ticket.id)?.status ?? ticket.status
  const currentTicket = { ...ticket, status: currentStatus }
  const meta = statusMetaFor(currentStatus, statuses)
  const Icon = meta.icon
  const statusLabel = statusLabelFor(currentStatus, statuses)
  const wrapperClass =
    size === "lg"
      ? "grid size-10 place-items-center rounded-lg bg-muted transition-colors group-hover/hitbox:bg-foreground/5"
      : cn(
          "grid size-6 place-items-center rounded-full transition-colors group-hover/hitbox:bg-foreground/5",
          meta.className
        )
  const iconClass = size === "lg" ? cn("size-5", meta.className) : "size-4"
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Hitbox
            mode="inline"
            margin={size === "lg" ? "1" : "2"}
            onClick={(e) => stopPropagation && e.stopPropagation()}
            aria-label={m.tickets_status_aria_label({ label: statusLabel })}
            title={statusLabel}
            disabled={updateState.waiting}
          >
            <span className={wrapperClass}>
              <Icon
                className={iconClass}
                style={meta.color ? { color: meta.color } : undefined}
                strokeWidth={1.75}
              />
            </span>
          </Hitbox>
        }
      />
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-44"
        onClick={(e) => e.stopPropagation()}
      >
        <StatusMenuItems
          orgSlug={orgSlug}
          slug={slug}
          current={currentStatus}
          statuses={statuses}
          onSelect={(status) =>
            update({
              ticket: currentTicket,
              status,
              sourceSectionKey: ticketsListKeyForStatus(
                orgSlug,
                slug,
                query,
                currentStatus
              ),
              destSectionKey: ticketsListKeyForStatus(
                orgSlug,
                slug,
                query,
                status
              ),
              countKey: ticketsCountKey(orgSlug, slug, {
                filter: query.filter,
                q: query.q
              })
            })
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

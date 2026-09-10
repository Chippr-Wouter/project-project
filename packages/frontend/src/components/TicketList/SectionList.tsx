import * as Result from "effect/unstable/reactivity/AsyncResult"
import { ErrorPage } from "@/components/ErrorPage"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Loader2 } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  loadMoreTicketsAtom,
  pendingTicketStatusChangesAtom,
  ticketsListKeyForStatus,
  type TicketSectionValue
} from "@/atoms/tickets"
import { projectKey } from "@/atoms/projects"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import type {
  Group,
  Member,
  ProjectStatus,
  Ticket,
  TicketId,
  TicketListQuery,
  TicketStatus
} from "@projectproject/shared"
import { Row } from "./Row"
import { AutoLoadPrototype, VirtualRowsPrototype } from "./VirtualRowsPrototype"
import { SectionHeader } from "./SectionHeader"
import { SectionTicketCreator } from "./SectionTicketCreator"

export function SectionList({
  orgSlug,
  slug,
  status,
  statuses,
  query,
  count,
  page,
  collapsed,
  onToggleCollapsed,
  members,
  sprintMembership,
  extraRowActions,
  showSprintCol,
  showExtraActionsCol,
  activePreviewId,
  onPreviewPointerEnter,
  onPreviewOpenChange
}: {
  orgSlug: string
  slug: string
  status: TicketStatus
  statuses: ReadonlyArray<ProjectStatus>
  query: TicketListQuery
  count: number
  page: TicketSectionValue
  collapsed: boolean
  onToggleCollapsed: () => void
  members: ReadonlyArray<Member>
  sprintMembership?: ReadonlyMap<TicketId, Group>
  extraRowActions?: (ticket: Ticket) => ReactNode
  showSprintCol: boolean
  showExtraActionsCol: boolean
  activePreviewId: TicketId | null
  onPreviewPointerEnter: (ticketId: TicketId) => void
  onPreviewOpenChange: (ticketId: TicketId, open: boolean) => void
}) {
  const sectionKey = ticketsListKeyForStatus(orgSlug, slug, query, status)
  const pendingStatusChanges = useAtomValue(
    pendingTicketStatusChangesAtom(projectKey(orgSlug, slug))
  )
  const loadMore = useAtomSet(loadMoreTicketsAtom(sectionKey))
  const loadMoreState = useAtomValue(loadMoreTicketsAtom(sectionKey))
  const loadingMore = loadMoreState.waiting

  const [creating, setCreating] = useState(false)

  const { items, nextCursor } = page
  const remaining = Math.max(0, count - items.length)

  const gridCols = cn(
    "grid gap-y-1",
    showExtraActionsCol
      ? "grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto_auto]"
      : "grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto]"
  )

  const shellRef = useRef<HTMLDivElement>(null)

  const onStartCreate = () => {
    if (collapsed) onToggleCollapsed()
    setCreating(true)
  }
  const onDismissCreate = () => setCreating(false)

  return (
    <div
      className="flex flex-col transition-opacity duration-200 ease-out"
      data-creating={creating || undefined}
    >
      <SectionHeader
        ref={shellRef}
        variant="sticky"
        status={status}
        statuses={statuses}
        count={count}
        collapsed={collapsed}
        creating={creating}
        onToggleCollapsed={onToggleCollapsed}
        onStartCreate={onStartCreate}
        onDismissCreate={onDismissCreate}
        creator={
          <SectionTicketCreator
            orgSlug={orgSlug}
            slug={slug}
            status={status}
            query={query}
            containerRef={shellRef}
            onDone={onDismissCreate}
          />
        }
      />

      <div
        aria-hidden={collapsed || undefined}
        inert={collapsed ? true : undefined}
        className={cn(
          "grid duration-150 transition-[grid-template-rows,opacity] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none",
          collapsed
            ? "grid-rows-[0fr] opacity-0"
            : "grid-rows-[1fr] opacity-100"
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-1 pt-1">
            {items.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                —
              </div>
            ) : (
              <VirtualRowsPrototype
                key={sectionKey}
                className={gridCols}
                rowKeys={items.map((row) => row.key)}
                activeIndex={items.findIndex(
                  ({ ticket }) => ticket.id === activePreviewId
                )}
              >
                {(index) => {
                  const { ticket, pending } = items[index]
                  return (
                    <div
                      className={cn(
                        "col-span-full grid grid-cols-subgrid",
                        pending && "pointer-events-none animate-pulse",
                        pendingStatusChanges.has(ticket.id) && "animate-pulse"
                      )}
                    >
                      <Row
                        orgSlug={orgSlug}
                        slug={slug}
                        ticket={ticket}
                        query={query}
                        members={members}
                        showSprintCol={showSprintCol}
                        showExtraActionsCol={showExtraActionsCol}
                        sprintMembership={
                          sprintMembership?.get(ticket.id) ?? null
                        }
                        extraRowActions={extraRowActions}
                        pending={pending}
                        previewOpen={activePreviewId === ticket.id}
                        onPreviewPointerEnter={onPreviewPointerEnter}
                        onPreviewOpenChange={onPreviewOpenChange}
                      />
                    </div>
                  )
                }}
              </VirtualRowsPrototype>
            )}

            {Result.matchWithError(loadMoreState, {
              onInitial: () => null,
              onError: (error) => (
                <ErrorPage error={error} reset={() => loadMore()} contained />
              ),
              onDefect: (defect) => (
                <ErrorPage error={defect} reset={() => loadMore()} contained />
              ),
              onSuccess: () => null
            })}
            {nextCursor !== null && (
              <AutoLoadPrototype
                key={sectionKey}
                cursor={nextCursor}
                enabled={
                  !collapsed && !loadingMore && !Result.isFailure(loadMoreState)
                }
                loadMore={() => loadMore()}
              >
                {Result.isFailure(loadMoreState) ? (
                  <Button
                    type="button"
                    variant="tertiary"
                    size="sm"
                    onClick={() => loadMore()}
                  >
                    {m.tickets_section_load_more_button({ remaining })}
                  </Button>
                ) : (
                  <div
                    role="status"
                    className={cn(
                      "flex h-7 items-center gap-2 text-xs text-muted-foreground",
                      !loadingMore && "invisible"
                    )}
                  >
                    <Loader2
                      className="size-4 animate-spin motion-reduce:animate-none"
                      strokeWidth={1.75}
                    />
                    {m.tickets_load_more_loading()}
                  </div>
                )}
              </AutoLoadPrototype>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

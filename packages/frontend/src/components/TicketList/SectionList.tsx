import * as Result from "effect/unstable/reactivity/AsyncResult"
import { ErrorPage } from "@/components/ErrorPage"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
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
import { transitions } from "@/lib/springs"
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
  const reducedMotion = useReducedMotion()
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
              <ul
                className={gridCols}
                style={{
                  contentVisibility: "auto",
                  containIntrinsicBlockSize: `auto ${Math.max(0, items.length * 56 - 4)}px`
                }}
              >
                <AnimatePresence initial={false}>
                  {items.map(({ ticket, key, pending }) => (
                    <motion.li
                      key={key}
                      inert={pending}
                      aria-busy={pending}
                      initial={
                        pending && !reducedMotion ? { opacity: 0 } : false
                      }
                      animate={{ opacity: 1 }}
                      transition={transitions.presence}
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
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}

            {Result.matchWithError(loadMoreState, {
              onInitial: () => null,
              onError: (error) => <ErrorPage error={error} contained />,
              onDefect: (defect) => <ErrorPage error={defect} contained />,
              onSuccess: () => null
            })}
            {nextCursor !== null && (
              <div className="flex justify-center py-2">
                <Button
                  type="button"
                  variant="tertiary"
                  size="sm"
                  onClick={() => loadMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2
                        className="size-4 animate-spin"
                        strokeWidth={1.75}
                      />
                      {m.tickets_load_more_loading()}
                    </>
                  ) : (
                    m.tickets_section_load_more_button({ remaining })
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

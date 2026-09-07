import { Result, useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import { AnimatePresence, motion } from "motion/react"
import { Loader2 } from "lucide-react"
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from "react"
import { Button } from "@/components/ui/button"
import { ErrorPage } from "@/components/ErrorPage"
import {
  loadMoreTicketsAtom,
  pendingTicketStatusChangesAtom,
  ticketsListAtom,
  ticketsListKeyForStatus,
  type TicketsListValue
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

const EMPTY_ITEMS: ReadonlyArray<Ticket> = []

export function SectionList({
  orgSlug,
  slug,
  status,
  statuses,
  query,
  count,
  collapsed,
  onToggleCollapsed,
  members,
  sprintMembership,
  extraRowActions,
  showSprintCol,
  showExtraActionsCol
}: {
  orgSlug: string
  slug: string
  status: TicketStatus
  statuses: ReadonlyArray<ProjectStatus>
  query: TicketListQuery
  count: number
  collapsed: boolean
  onToggleCollapsed: () => void
  members: ReadonlyArray<Member>
  sprintMembership?: ReadonlyMap<TicketId, Group>
  extraRowActions?: (ticket: Ticket) => ReactNode
  showSprintCol: boolean
  showExtraActionsCol: boolean
}) {
  const sectionKey = ticketsListKeyForStatus(orgSlug, slug, query, status)
  const deferredKey = useDeferredValue(sectionKey)
  const list = useAtomValue(ticketsListAtom(deferredKey))
  const pendingStatusChanges = useAtomValue(
    pendingTicketStatusChangesAtom(projectKey(orgSlug, slug))
  )
  const isStaleKey = sectionKey !== deferredKey

  const previousRef = useRef<TicketsListValue | null>(null)
  if (Result.isSuccess(list)) previousRef.current = list.value

  const listFailure =
    previousRef.current === null && Result.isFailure(list) ? list : null

  const loadMore = useAtomSet(loadMoreTicketsAtom(deferredKey))
  const loadMoreState = useAtomValue(loadMoreTicketsAtom(deferredKey))
  const loadingMore = loadMoreState.waiting

  const [creating, setCreating] = useState(false)

  const items: ReadonlyArray<Ticket> = Result.isSuccess(list)
    ? list.value.items
    : (previousRef.current?.items ?? EMPTY_ITEMS)
  const nextCursor: string | null = Result.isSuccess(list)
    ? list.value.nextCursor
    : (previousRef.current?.nextCursor ?? null)
  const waiting =
    (Result.isSuccess(list) && list.waiting === true) || isStaleKey

  const itemRowState = useStableTicketKeys(items, waiting)

  const remaining = Math.max(0, count - items.length)

  const gridCols = cn(
    "grid gap-y-1",
    showExtraActionsCol
      ? "grid-cols-[auto_auto_auto_minmax(0,1fr)_auto_auto]"
      : "grid-cols-[auto_auto_auto_minmax(0,1fr)_auto]",
    waiting && "animate-pulse"
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
            {listFailure !== null ? (
              Result.matchWithError(listFailure, {
                onInitial: () => null,
                onError: (error) => <ErrorPage error={error} contained />,
                onDefect: (defect) => <ErrorPage error={defect} contained />,
                onSuccess: () => null
              })
            ) : items.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                —
              </div>
            ) : (
              <ul className={gridCols}>
                <AnimatePresence initial={false}>
                  {items.map((t, idx) => {
                    const membership = sprintMembership?.get(t.id) ?? null
                    const rowState = itemRowState[idx]
                    return (
                      <motion.li
                        key={rowState.key}
                        initial={{ opacity: 0, filter: "blur(8px)" }}
                        animate={{ opacity: 1, filter: "blur(0px)" }}
                        transition={transitions.presence}
                        className={cn(
                          "col-span-full grid grid-cols-subgrid",
                          pendingStatusChanges.has(t.id) && "animate-pulse"
                        )}
                      >
                        <Row
                          orgSlug={orgSlug}
                          slug={slug}
                          ticket={t}
                          query={query}
                          members={members}
                          showSprintCol={showSprintCol}
                          showExtraActionsCol={showExtraActionsCol}
                          sprintMembership={membership}
                          extraRowActions={extraRowActions}
                          pending={rowState.pending}
                        />
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            )}

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

interface RowState {
  readonly key: string
  readonly pending: boolean
}

export function useStableTicketKeys(
  items: ReadonlyArray<Pick<Ticket, "id">>,
  waiting: boolean
): ReadonlyArray<RowState> {
  const entriesRef = useRef<
    Map<TicketId, { key: string; bornWaiting: boolean }>
  >(new Map())
  const prevItemsRef = useRef<ReadonlyArray<Pick<Ticket, "id">>>(items)
  const prevWaitingRef = useRef<boolean>(waiting)
  const keySequenceRef = useRef(0)

  const justSettled = prevWaitingRef.current && !waiting
  const prevItems = prevItemsRef.current
  const currIds = new Set(items.map((t) => t.id))

  const states = items.map<RowState>((t, idx) => {
    const existing = entriesRef.current.get(t.id)
    if (existing !== undefined) {
      const stillPending = existing.bornWaiting && waiting
      if (existing.bornWaiting && !waiting) {
        entriesRef.current.set(t.id, { ...existing, bornWaiting: false })
      }
      return { key: existing.key, pending: stillPending }
    }
    if (justSettled) {
      const prevAtIdx = prevItems[idx]
      if (prevAtIdx && !currIds.has(prevAtIdx.id)) {
        const prevEntry = entriesRef.current.get(prevAtIdx.id)
        const inheritedKey = prevEntry?.key ?? prevAtIdx.id
        entriesRef.current.delete(prevAtIdx.id)
        entriesRef.current.set(t.id, {
          key: inheritedKey,
          bornWaiting: false
        })
        return { key: inheritedKey, pending: false }
      }
    }
    const usedKeys = new Set(
      [...entriesRef.current.values()].map(({ key }) => key)
    )
    const key = usedKeys.has(t.id)
      ? `${t.id}:${++keySequenceRef.current}`
      : t.id
    entriesRef.current.set(t.id, { key, bornWaiting: waiting })
    return { key, pending: waiting }
  })

  useEffect(() => {
    prevItemsRef.current = items
    prevWaitingRef.current = waiting
    if (entriesRef.current.size > 200) {
      const live = new Set(items.map((t) => t.id))
      for (const id of entriesRef.current.keys()) {
        if (!live.has(id)) entriesRef.current.delete(id)
      }
    }
  }, [items, waiting])

  return states
}

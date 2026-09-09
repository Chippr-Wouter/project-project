import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue, useAtomSet, useAtomRefresh } from "@effect/atom-react"
import { motion, Reorder } from "motion/react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element"
import {
  pendingTicketStatusAtom,
  placeTicketAtom,
  sprintKey
} from "@/atoms/sprints"
import { ticketsInSprintAtom, ticketsInSprintKey } from "@/atoms/tickets"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom,
  projectStatusesBaseAtom
} from "@/atoms/projectStatuses"
import type {
  GroupId,
  Member,
  ProjectStatus,
  Ticket,
  TicketId
} from "@projectproject/shared"
import { cn } from "@/lib/utils"
import {
  boardStatusesFor,
  groupTicketsByStatus,
  type CardDropData,
  type ColumnDropData,
  type DragData
} from "./board-utils"
import { ErrorPage } from "@/components/ErrorPage"
import { DitherShell } from "@/components/ui/dither-shell"
import { SprintBoardColumn } from "./SprintBoardColumn"

type SprintBoardProps = {
  orgSlug: string
  slug: string
  groupId: GroupId
  ticketIds: ReadonlyArray<TicketId>
  members: ReadonlyArray<Member>
  isCompleted: boolean
  reorderMode: boolean
  onEnterReorder: () => void
  onExitReorder: () => void
  dragOrder: ReadonlyArray<string> | null
  setDragOrder: (next: ReadonlyArray<string> | null) => void
}

export function SprintBoard(props: SprintBoardProps) {
  const { orgSlug, slug, groupId } = props
  const atom = ticketsInSprintAtom(ticketsInSprintKey(orgSlug, slug, groupId))
  const list = useAtomValue(atom)
  const statusKey = projectStatusKey(orgSlug, slug)
  const statuses = useAtomValue(projectStatusesAtom(statusKey))
  const refreshTickets = useAtomRefresh(atom)
  const refreshStatuses = useAtomRefresh(projectStatusesBaseAtom(statusKey))
  const refresh = () => {
    if (Result.isFailure(list)) refreshTickets()
    if (Result.isFailure(statuses)) refreshStatuses()
  }

  return Result.matchWithError(Result.all({ tickets: list, statuses }), {
    onInitial: () => (
      <DitherShell contained animated>
        {null}
      </DitherShell>
    ),
    onError: (error) => <ErrorPage error={error} reset={refresh} contained />,
    onDefect: (defect) => (
      <ErrorPage error={defect} reset={refresh} contained />
    ),
    onSuccess: ({ value, waiting }) => (
      <SprintBoardContent
        {...props}
        tickets={value.tickets}
        statuses={value.statuses}
        waiting={waiting}
      />
    )
  })
}

function SprintBoardContent({
  orgSlug,
  slug,
  groupId,
  ticketIds,
  members,
  isCompleted,
  reorderMode,
  onEnterReorder,
  onExitReorder,
  dragOrder,
  setDragOrder,
  tickets,
  statuses,
  waiting
}: SprintBoardProps & {
  tickets: ReadonlyArray<Ticket>
  statuses: ReadonlyArray<ProjectStatus>
  waiting: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null)
  const [hasRightOverflow, setHasRightOverflow] = useState(true)

  useEffect(() => {
    if (reorderMode) {
      const w = groupRef.current?.scrollWidth ?? null
      if (w) setFrozenWidth(w)
    } else {
      setFrozenWidth(null)
    }
  }, [reorderMode])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const scrollRoot = el.closest("[data-scroll-root]")
    const scrollContent = el.closest("[data-scroll-content]")
    const container =
      scrollRoot instanceof HTMLElement ? scrollRoot : document.body
    const paddingSource =
      scrollContent instanceof HTMLElement ? scrollContent : container
    const update = () => {
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const style = window.getComputedStyle(paddingSource)
      const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
      setHeight(Math.max(240, containerRect.bottom - rect.top - paddingBottom))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(container)
    window.addEventListener("resize", update)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setHasRightOverflow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener("scroll", update)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!reorderMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExitReorder()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [reorderMode, onExitReorder])

  const key = sprintKey(orgSlug, slug, groupId)
  const overlay = useAtomValue(pendingTicketStatusAtom(key))
  const place = useAtomSet(placeTicketAtom(key))
  const statusSlugs = useMemo(() => boardStatusesFor(statuses), [statuses])

  const order = dragOrder ?? statusSlugs

  const [lastFlash, setLastFlash] = useState<{
    id: TicketId
    tick: number
  } | null>(null)
  const flash = (id: TicketId) =>
    setLastFlash((prev) => ({ id, tick: (prev?.tick ?? 0) + 1 }))

  const ticketById = useMemo(() => {
    const m = new Map<TicketId, Ticket>()
    for (const ticket of tickets) m.set(ticket.id, ticket)
    return m
  }, [tickets])

  const grouped = useMemo(
    () => groupTicketsByStatus(ticketIds, ticketById, overlay, order),
    [ticketIds, ticketById, overlay, order]
  )
  const groupedRef = useRef(grouped)
  groupedRef.current = grouped

  useEffect(() => {
    const el = ref.current
    if (!el || isCompleted || reorderMode) return
    const cleanupAutoScroll = autoScrollForElements({ element: el })
    const cleanupMonitor = monitorForElements({
      onDrop({ source, location }) {
        const target = location.current.dropTargets[0]
        if (!target) return
        const src = source.data as unknown as DragData
        const dst = target.data as unknown as CardDropData | ColumnDropData
        if (src.type !== "card") return
        if (dst.type === "card" && dst.id === src.id) return

        const current = groupedRef.current
        let after: TicketId | null
        let nextStatus: string
        if (dst.type === "card") {
          nextStatus = dst.status
          const inColumn = current[dst.status] ?? []
          const idx = inColumn.findIndex((t) => t.id === dst.id)
          if (dst.edge === "bottom") {
            after = dst.id
          } else {
            after = idx > 0 ? inColumn[idx - 1].id : null
          }
        } else {
          nextStatus = dst.status
          const inColumn = current[dst.status] ?? []
          after = inColumn.length > 0 ? inColumn[inColumn.length - 1].id : null
        }
        if (after === src.id) return
        const status =
          nextStatus !== src.status
            ? (nextStatus as import("@projectproject/shared").TicketStatus)
            : undefined
        place({ ticketId: src.id, status, after })
        flash(src.id)
      }
    })
    return () => {
      cleanupAutoScroll()
      cleanupMonitor()
    }
  }, [isCompleted, reorderMode, place])

  return (
    <motion.div
      ref={ref}
      layoutScroll
      aria-busy={waiting}
      style={{ height: height ? `${height}px` : undefined }}
      className={cn(
        "overflow-x-auto pt-2 pb-4",
        waiting && "animate-pulse motion-reduce:animate-none",
        hasRightOverflow &&
          "[mask-image:linear-gradient(to_right,black_calc(100%-16px),transparent)]"
      )}
    >
      <Reorder.Group
        ref={groupRef}
        as="div"
        axis="x"
        values={order as Array<string>}
        onReorder={(next) => setDragOrder(next)}
        style={frozenWidth ? { width: `${frozenWidth}px` } : undefined}
        className="flex h-full gap-3"
      >
        {order.map((status) => (
          <SprintBoardColumn
            key={status}
            orgSlug={orgSlug}
            slug={slug}
            status={status}
            statuses={statuses}
            tickets={grouped[status] ?? []}
            members={members}
            isDraggable={!isCompleted}
            overlay={overlay}
            lastFlash={lastFlash}
            reorderMode={reorderMode}
            onActivateReorder={onEnterReorder}
          />
        ))}
      </Reorder.Group>
    </motion.div>
  )
}

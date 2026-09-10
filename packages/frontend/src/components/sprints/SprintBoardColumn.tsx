import NumberFlow from "@number-flow/react"
import { motion, Reorder, useDragControls } from "motion/react"
import { GripVertical } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  draggable,
  dropTargetForElements,
  monitorForElements
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview"
import { preserveOffsetOnSource } from "@atlaskit/pragmatic-drag-and-drop/element/preserve-offset-on-source"
import { statusMetaFor } from "@/lib/ticket-meta"
import { cn } from "@/lib/utils"
import type {
  Member,
  ProjectStatus,
  Ticket,
  TicketId
} from "@projectproject/shared"
import { VirtualSprintCardsPrototype } from "./VirtualSprintCardsPrototype"
import { SprintBoardCard } from "./SprintBoardCard"
import { useLongPress } from "./BoardReorderMode"
import type { CardDropData, ColumnDropData, DragData } from "./board-utils"

const LONG_PRESS_MS = 500
const QUICK_S = 0.2
const REORDER_EASE = [0.32, 0.72, 0, 1] as const

export function SprintBoardColumn({
  orgSlug,
  slug,
  sprintTicketsKey,
  status,
  statuses,
  tickets,
  members,
  isDraggable,
  overlay,
  lastFlash,
  reorderMode,
  onActivateReorder
}: {
  orgSlug: string
  slug: string
  sprintTicketsKey: string
  status: string
  statuses: ReadonlyArray<ProjectStatus>
  tickets: ReadonlyArray<Ticket>
  members: ReadonlyArray<Member>
  isDraggable: boolean
  overlay: ReadonlyMap<TicketId, string>
  lastFlash: { id: TicketId; tick: number } | null
  reorderMode: boolean
  onActivateReorder: () => void
}) {
  const meta = statusMetaFor(status, statuses)
  const Icon = meta.icon
  const [columnEl, setColumnEl] = useState<HTMLElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragControls = useDragControls()

  const { holding, handlers: longPressHandlers } = useLongPress((event) => {
    onActivateReorder()
    dragControls.start(event)
  }, LONG_PRESS_MS)

  useEffect(() => {
    if (!isDraggable || reorderMode || !columnEl) return
    return dropTargetForElements({
      element: columnEl,
      getData: (): ColumnDropData => ({ type: "column", status })
    })
  }, [isDraggable, status, reorderMode, columnEl])

  useEffect(() => {
    if (!isDraggable || reorderMode || !columnEl) return
    const update = ({
      location
    }: {
      location: {
        current: { dropTargets: ReadonlyArray<{ element: Element }> }
      }
    }) => {
      const inner = location.current.dropTargets[0]?.element
      setDragOver(inner != null && columnEl.contains(inner))
    }
    return monitorForElements({
      onDragStart: update,
      onDrag: update,
      onDrop: () => setDragOver(false)
    })
  }, [isDraggable, reorderMode, columnEl])

  const headerHoldable = isDraggable && !reorderMode

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if (reorderMode) {
      dragControls.start(e)
      return
    }
    if (headerHoldable) longPressHandlers.onPointerDown(e)
  }

  return (
    <Reorder.Item
      value={status}
      layout="position"
      dragListener={false}
      dragControls={dragControls}
      dragElastic={0.05}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={() => setIsDragging(false)}
      ref={setColumnEl}
      animate={{
        filter:
          holding || isDragging
            ? "drop-shadow(0 10px 24px rgb(0 0 0 / 0.12))"
            : "drop-shadow(0 0 0 transparent)",
        zIndex: isDragging ? 20 : 0
      }}
      transition={{
        filter: { duration: QUICK_S, ease: REORDER_EASE },
        zIndex: { duration: 0 }
      }}
      className="flex max-h-full w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-background"
    >
      <div
        data-column-header
        onPointerDown={onHeaderPointerDown}
        onPointerMove={
          headerHoldable ? longPressHandlers.onPointerMove : undefined
        }
        onPointerUp={headerHoldable ? longPressHandlers.onPointerUp : undefined}
        onPointerCancel={
          headerHoldable ? longPressHandlers.onPointerCancel : undefined
        }
        onPointerLeave={
          headerHoldable ? longPressHandlers.onPointerLeave : undefined
        }
        className={cn(
          "relative flex items-center justify-between px-3.5 pt-3 pb-2 select-none",
          (headerHoldable || reorderMode) &&
            "touch-none cursor-grab active:cursor-grabbing"
        )}
      >
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium">
          <span className="grid size-6 shrink-0 place-items-center">
            <Icon
              className={cn("size-4", meta.className)}
              style={meta.color ? { color: meta.color } : undefined}
              strokeWidth={1.75}
            />
          </span>
          {meta.label}
        </span>
        <span className="grid shrink-0 place-items-center">
          <motion.span
            initial={false}
            animate={{ opacity: reorderMode ? 1 : 0 }}
            transition={{ duration: QUICK_S, ease: REORDER_EASE }}
            className="col-start-1 row-start-1 text-muted-foreground"
            aria-hidden
          >
            <GripVertical className="size-4" strokeWidth={1.75} />
          </motion.span>
          <motion.span
            initial={false}
            animate={{ opacity: reorderMode ? 0 : 1 }}
            transition={{ duration: QUICK_S, ease: REORDER_EASE }}
            className="col-start-1 row-start-1"
            aria-hidden={reorderMode}
          >
            <NumberFlow
              value={tickets.length}
              transformTiming={{ duration: 180, easing: "ease-out" }}
              spinTiming={{ duration: 180, easing: "ease-out" }}
              opacityTiming={{ duration: 180, easing: "ease-out" }}
              className="font-mono text-xs text-muted-foreground tabular-nums"
            />
          </motion.span>
        </span>
      </div>
      <motion.div
        animate={{
          opacity: reorderMode ? 0 : 1
        }}
        transition={{
          opacity: { duration: QUICK_S, ease: REORDER_EASE }
        }}
        style={{
          pointerEvents: reorderMode ? "none" : undefined,
          transformOrigin: "top center"
        }}
        className="relative flex min-h-0 flex-1 flex-col"
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-2 inset-y-3 z-0 rounded-md border border-dashed border-transparent transition-colors duration-150",
            dragOver && "border-border bg-accent/40"
          )}
        />
        <VirtualSprintCardsPrototype
          tickets={tickets}
          isDraggable={isDraggable && !reorderMode}
          status={status}
        >
          {(ticket) => (
            <CardSlot
              orgSlug={orgSlug}
              slug={slug}
              sprintTicketsKey={sprintTicketsKey}
              ticket={ticket}
              status={status}
              members={members}
              isDraggable={isDraggable && !reorderMode}
              pending={overlay.has(ticket.id)}
              flashKey={
                lastFlash?.id === ticket.id ? lastFlash.tick : undefined
              }
            />
          )}
        </VirtualSprintCardsPrototype>
      </motion.div>
    </Reorder.Item>
  )
}

function CardSlot({
  orgSlug,
  slug,
  sprintTicketsKey,
  ticket,
  status,
  members,
  isDraggable,
  pending,
  flashKey
}: {
  orgSlug: string
  slug: string
  sprintTicketsKey: string
  ticket: Ticket
  status: string
  members: ReadonlyArray<Member>
  isDraggable: boolean
  pending: boolean
  flashKey: number | undefined
}) {
  const ticketId = ticket.id
  const ref = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!isDraggable) return
    const el = ref.current
    const card = cardRef.current
    if (!el || !card) return
    const cleanupDrag = draggable({
      element: card,
      getInitialData: (): DragData => ({
        type: "card",
        id: ticketId,
        status
      }),
      onGenerateDragPreview: ({ location, nativeSetDragImage }) => {
        setCustomNativeDragPreview({
          nativeSetDragImage,
          getOffset: preserveOffsetOnSource({
            element: card,
            input: location.current.input
          }),
          render: ({ container }) => {
            const rect = card.getBoundingClientRect()
            const clone = card.cloneNode(true) as HTMLElement
            clone.style.width = `${rect.width}px`
            clone.style.height = `${rect.height}px`
            container.appendChild(clone)
          }
        })
      },
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false)
    })
    const cleanupDrop = dropTargetForElements({
      element: el.closest<HTMLElement>("[data-ticket-id]") ?? el,
      getData: ({ input, element }): CardDropData => {
        const rect = element.getBoundingClientRect()
        const e: "top" | "bottom" =
          input.clientY < rect.top + rect.height / 2 ? "top" : "bottom"
        return { type: "card", id: ticketId, status, edge: e }
      }
    })
    return () => {
      cleanupDrag()
      cleanupDrop()
    }
  }, [ticketId, status, isDraggable])

  return (
    <div ref={ref} className="relative px-2 py-1">
      <div
        ref={cardRef}
        className={cn(
          "rounded-md",
          dragging && "opacity-40",
          pending && "animate-pulse"
        )}
      >
        <motion.div
          key={flashKey ?? 0}
          initial={
            flashKey ? { boxShadow: "0 0 0 3px var(--foreground)" } : false
          }
          animate={{ boxShadow: "0 0 0 0px transparent" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="rounded-md"
        >
          <SprintBoardCard
            orgSlug={orgSlug}
            slug={slug}
            sprintTicketsKey={sprintTicketsKey}
            ticket={ticket}
            members={members}
          />
        </motion.div>
      </div>
    </div>
  )
}

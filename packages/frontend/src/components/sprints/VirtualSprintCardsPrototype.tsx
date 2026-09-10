import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { useReducedMotion } from "motion/react"
import { useSprintEdgeScrollPrototype } from "./useSprintEdgeScrollPrototype"
import { useDeferredOverscanPrototype } from "../TicketList/useDeferredOverscanPrototype"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { SprintCardMotionPrototype } from "./SprintCardMotionPrototype"
import type { Ticket } from "@projectproject/shared"

export function VirtualSprintCardsPrototype({
  tickets,
  isDraggable,
  status,
  children
}: {
  tickets: ReadonlyArray<Ticket>
  isDraggable: boolean
  status: string
  children: (ticket: Ticket) => ReactNode
}) {
  "use no memo"

  const reducedMotion = useReducedMotion()
  const [drag, setDrag] = useState<{
    id: string
    index: number | null
    height: number
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const getScrollElement = useCallback(() => scrollRef.current, [])
  const overscan = useDeferredOverscanPrototype(getScrollElement, 4)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const focusedIndex = tickets.findIndex((ticket) => ticket.id === focusedId)
  const getItemKey = useCallback(
    (index: number) => tickets[index].id,
    [tickets]
  )
  // oxlint-disable-next-line react/incompatible-library -- This component opts out of React Compiler.
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: tickets.length,
    getScrollElement,
    getItemKey,
    estimateSize: () => 96,
    overscan,
    rangeExtractor: useCallback(
      (range) => {
        const indexes = defaultRangeExtractor(range)
        return focusedIndex >= 0 && !indexes.includes(focusedIndex)
          ? [...indexes, focusedIndex].toSorted((a, b) => a - b)
          : indexes
      },
      [focusedIndex]
    )
  })

  useSprintEdgeScrollPrototype(scrollRef, isDraggable)

  useEffect(() => {
    if (!isDraggable) return undefined
    const update: Parameters<typeof monitorForElements>[0]["onDrag"] = ({
      source,
      location
    }) => {
      if (source.data.type !== "card" || typeof source.data.id !== "string")
        return
      const target = location.current.dropTargets.find(
        ({ data }) => data.type === "card" || data.type === "column"
      )
      const index =
        target?.data.status !== status
          ? null
          : target.data.type === "column"
            ? tickets.length
            : target.data.id === source.data.id
              ? tickets.findIndex((ticket) => ticket.id === source.data.id)
              : tickets.findIndex((ticket) => ticket.id === target.data.id) +
                (target.data.edge === "bottom" ? 1 : 0)
      const height =
        source.element.closest("[data-ticket-id]")?.getBoundingClientRect()
          .height ?? 96
      const id = source.data.id
      setDrag((current) =>
        current?.id === id &&
        current.index === index &&
        current.height === height
          ? current
          : { id, index, height }
      )
    }
    return monitorForElements({
      onDragStart: update,
      onDrag: update,
      onDropTargetChange: update,
      onDrop: () => setDrag(null)
    })
  }, [isDraggable, status, tickets])

  const sourceIndex = drag
    ? tickets.findIndex((ticket) => ticket.id === drag.id)
    : -1
  const rows = virtualizer.getVirtualItems()
  const gapStart =
    drag?.index != null
      ? (rows.find((row) => row.index === drag.index)?.start ??
          virtualizer.getTotalSize()) -
        (sourceIndex >= 0 && sourceIndex < drag.index ? drag.height : 0)
      : null
  return (
    <div
      ref={scrollRef}
      data-virtual-sprint-column={status}
      data-loaded-cards={tickets.length}
      data-mounted-cards={rows.length}
      className="relative z-10 min-h-0 flex-1 overflow-y-auto pb-2"
      style={{ overflowAnchor: "none" }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocusedId(null)
      }}
    >
      <div
        className="relative w-full overflow-clip"
        style={{
          height:
            virtualizer.getTotalSize() +
            (drag?.index != null && sourceIndex < 0 ? drag.height : 0)
        }}
      >
        {gapStart !== null && drag && (
          <div
            aria-hidden
            data-sprint-drop-gap
            className="pointer-events-none absolute inset-x-2 top-0 rounded-md bg-accent/40"
            style={{
              height: drag.height - 8,
              transform: `translateY(${gapStart === 0 ? 0 : gapStart + 4}px)`
            }}
          />
        )}
        {rows.map((row) => (
          <div
            key={row.key}
            ref={virtualizer.measureElement}
            data-index={row.index}
            data-ticket-id={tickets[row.index].id}
            className="absolute top-0 left-0 w-full"
            style={{
              transform: `translateY(${row.start}px)`,
              minHeight: 96
            }}
            onFocusCapture={() => setFocusedId(tickets[row.index].id)}
          >
            <SprintCardMotionPrototype
              start={row.start}
              offset={
                drag && row.index !== sourceIndex
                  ? (sourceIndex >= 0 && row.index > sourceIndex
                      ? -drag.height
                      : 0) +
                    (drag.index !== null && row.index >= drag.index
                      ? drag.height
                      : 0)
                  : 0
              }
              hidden={drag?.id === tickets[row.index].id}
              reducedMotion={Boolean(reducedMotion) || virtualizer.isScrolling}
            >
              {children(tickets[row.index])}
            </SprintCardMotionPrototype>
          </div>
        ))}
      </div>
    </div>
  )
}

import { useEffect, type RefObject } from "react"
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"

const edgeZone = 120

export function useSprintEdgeScroll(
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return undefined
    let pointer: { clientX: number; clientY: number } | null = null
    let frame = 0
    let lastTime = 0
    let engagedAt = 0
    let direction = 0
    let remainder = 0

    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
      lastTime = 0
      engagedAt = 0
      direction = 0
      remainder = 0
    }

    const tick = (now: number) => {
      frame = 0
      if (!pointer) return stop()
      const rect = element.getBoundingClientRect()
      if (
        pointer.clientX < rect.left ||
        pointer.clientX > rect.right ||
        pointer.clientY < rect.top ||
        pointer.clientY > rect.bottom
      )
        return stop()
      const zone = Math.min(edgeZone, rect.height / 2)
      const top = Math.max(0, 1 - (pointer.clientY - rect.top) / zone)
      const bottom = Math.max(0, 1 - (rect.bottom - pointer.clientY) / zone)
      const nextDirection = bottom > 0 ? 1 : top > 0 ? -1 : 0
      if (
        !nextDirection ||
        (nextDirection < 0 && element.scrollTop <= 0) ||
        (nextDirection > 0 &&
          element.scrollTop >= element.scrollHeight - element.clientHeight - 1)
      )
        return stop()
      if (direction !== nextDirection) {
        direction = nextDirection
        engagedAt = now
        lastTime = now
        remainder = 0
      }
      const depth = Math.min(1, Math.max(top, bottom) / 0.8)
      const speed = (400 + 500 * Math.min(1, (now - engagedAt) / 250)) * depth
      const distance = (speed * Math.min(32, now - lastTime)) / 1000 + remainder
      const pixels = Math.floor(distance)
      remainder = distance - pixels
      element.scrollTop += direction * pixels
      lastTime = now
      frame = requestAnimationFrame(tick)
    }

    const updatePointer = (input: { clientX: number; clientY: number }) => {
      pointer = input
      const rect = element.getBoundingClientRect()
      const zone = Math.min(edgeZone, rect.height / 2)
      if (
        input.clientX < rect.left ||
        input.clientX > rect.right ||
        input.clientY < rect.top ||
        input.clientY > rect.bottom ||
        (input.clientY >= rect.top + zone &&
          input.clientY <= rect.bottom - zone)
      ) {
        stop()
        return
      }
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onDragOver = (event: DragEvent) => {
      if (pointer) updatePointer(event)
    }
    window.addEventListener("dragover", onDragOver, true)
    const release = monitorForElements({
      onDragStart: ({ source, location }) => {
        if (source.data.type === "card") updatePointer(location.current.input)
      },
      onDrop: () => {
        pointer = null
        stop()
      }
    })
    return () => {
      release()
      window.removeEventListener("dragover", onDragOver, true)
      stop()
    }
  }, [ref, enabled])
}

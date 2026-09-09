import { useCallback, useEffect, useRef, useState } from "react"

export type LongPressHandlers = {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: () => void
  onPointerCancel: () => void
  onPointerLeave: () => void
}

export function useLongPress(
  onLongPress: (event: PointerEvent) => void,
  delay = 500,
  moveThreshold = 6
): { holding: boolean; handlers: LongPressHandlers } {
  const timeoutRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [holding, setHolding] = useState(false)

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    startRef.current = null
    setHolding(false)
  }, [])

  useEffect(() => clear, [clear])

  const handlers: LongPressHandlers = {
    onPointerDown: (e) => {
      if (e.button !== undefined && e.button !== 0) return
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      startRef.current = { x: e.clientX, y: e.clientY }
      setHolding(true)
      timeoutRef.current = window.setTimeout(() => {
        onLongPress(e.nativeEvent)
        clear()
      }, delay)
    },
    onPointerMove: (e) => {
      if (!startRef.current) return
      const dx = e.clientX - startRef.current.x
      const dy = e.clientY - startRef.current.y
      if (dx * dx + dy * dy > moveThreshold * moveThreshold) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear
  }

  return { holding, handlers }
}

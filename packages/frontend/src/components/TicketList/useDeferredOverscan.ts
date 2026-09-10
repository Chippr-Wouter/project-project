import { startTransition, useEffect, useState } from "react"

export function useDeferredOverscan(
  getScrollElement: () => HTMLElement | null,
  overscan: number
) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const element = getScrollElement()
    const onScroll = () => setReady(true)
    const timer = window.setTimeout(() => {
      startTransition(() => setReady(true))
    }, 200)
    element?.addEventListener("scroll", onScroll, { passive: true, once: true })
    return () => {
      window.clearTimeout(timer)
      element?.removeEventListener("scroll", onScroll)
    }
  }, [getScrollElement])

  return ready ? overscan : 0
}

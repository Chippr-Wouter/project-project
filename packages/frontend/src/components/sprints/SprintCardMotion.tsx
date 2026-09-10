import { useLayoutEffect, useRef, type ReactNode } from "react"

export function SprintCardMotion({
  start,
  offset,
  hidden,
  reducedMotion,
  children
}: {
  start: number
  offset: number
  hidden: boolean
  reducedMotion: boolean
  children: ReactNode
}) {
  const element = useRef<HTMLDivElement>(null)
  const previous = useRef<{ start: number; hidden: boolean } | null>(null)
  const animation = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const before = previous.current
    const transform = getComputedStyle(node).transform
    const currentOffset =
      transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42
    const from = before ? before.start + currentOffset - start : offset
    animation.current?.cancel()
    node.style.transform = `translateY(${offset}px)`
    previous.current = { start, hidden }
    if (
      !before ||
      before.hidden ||
      hidden ||
      reducedMotion ||
      Math.abs(from - offset) < 0.5
    )
      return
    animation.current = node.animate(
      [
        { transform: `translateY(${from}px)` },
        { transform: `translateY(${offset}px)` }
      ],
      { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    )
  }, [start, offset, hidden, reducedMotion])

  useLayoutEffect(() => () => animation.current?.cancel(), [])

  return (
    <div
      ref={element}
      data-sprint-card-motion
      style={{
        opacity: hidden ? 0 : 1,
        pointerEvents: hidden ? "none" : undefined
      }}
    >
      {children}
    </div>
  )
}

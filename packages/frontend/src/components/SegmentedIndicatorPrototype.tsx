import { useLayoutEffect, useRef } from "react"
import { useReducedMotion } from "motion/react"

export function SegmentedIndicatorPrototype({
  activeIndex,
  className
}: {
  activeIndex: number
  className: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const previous = useRef<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const animation = useRef<Animation | null>(null)
  const reducedMotion = useReducedMotion()

  useLayoutEffect(() => {
    const node = ref.current
    const root = node?.parentElement
    if (!root || !node) return undefined
    const target = Array.from(root.children).filter((child) => child !== node)[
      activeIndex
    ]
    if (!(target instanceof HTMLElement)) {
      animation.current?.cancel()
      node.style.visibility = "hidden"
      return undefined
    }
    const update = () => {
      const next = {
        left: target.offsetLeft,
        top: target.offsetTop,
        width: target.offsetWidth,
        height: target.offsetHeight
      }
      if (!next.width || !next.height) return
      const before = previous.current
      if (reducedMotion) animation.current?.cancel()
      if (
        before &&
        next.left === before.left &&
        next.top === before.top &&
        next.width === before.width &&
        next.height === before.height
      )
        return
      const transform = getComputedStyle(node).transform
      const current =
        transform === "none"
          ? new DOMMatrixReadOnly()
          : new DOMMatrixReadOnly(transform)
      animation.current?.cancel()
      const destination = `translate(${next.left}px, ${next.top}px)`
      node.style.width = `${next.width}px`
      node.style.height = `${next.height}px`
      node.style.transform = destination
      node.style.visibility = "visible"
      previous.current = next
      if (!before || reducedMotion) return
      animation.current = node.animate(
        [
          {
            transform: `translate(${current.m41}px, ${current.m42}px) scaleX(${(before.width * current.m11) / next.width})`
          },
          { transform: destination }
        ],
        { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    for (const child of root.children)
      if (child !== node) observer.observe(child)
    return () => observer.disconnect()
  }, [activeIndex, reducedMotion])

  useLayoutEffect(() => () => animation.current?.cancel(), [])

  return (
    <span
      ref={ref}
      aria-hidden
      data-native-tab-indicator
      className={className}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transformOrigin: "top left",
        pointerEvents: "none",
        visibility: "hidden"
      }}
    />
  )
}

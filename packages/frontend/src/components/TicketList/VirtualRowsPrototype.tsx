import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react"

export function VirtualRowsPrototype({
  rowKeys,
  className,
  activeIndex,
  children
}: {
  rowKeys: ReadonlyArray<string>
  className: string
  activeIndex: number
  children: (index: number) => ReactNode
}) {
  "use no memo"

  const listRef = useRef<HTMLUListElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const getScrollElement = useCallback(
    () => listRef.current?.closest<HTMLElement>("[data-scroll-root]") ?? null,
    []
  )
  const getItemKey = useCallback((index: number) => rowKeys[index], [rowKeys])
  // oxlint-disable-next-line react/incompatible-library -- This component opts out of React Compiler.
  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({
    count: rowKeys.length,
    getScrollElement,
    getItemKey,
    estimateSize: () => 52,
    gap: 4,
    overscan: 6,
    scrollMargin,
    rangeExtractor: useCallback(
      (range) => {
        const indexes = new Set(defaultRangeExtractor(range))
        for (const index of [focusedIndex, activeIndex]) {
          if (index >= 0 && index < rowKeys.length) indexes.add(index)
        }
        return [...indexes].toSorted((a, b) => a - b)
      },
      [focusedIndex, activeIndex, rowKeys.length]
    )
  })

  useLayoutEffect(() => {
    const list = listRef.current
    const root = getScrollElement()
    const content = list?.closest("[data-scroll-content]")
    if (!list || !root || !content) return undefined
    const measure = () =>
      setScrollMargin(
        list.getBoundingClientRect().top -
          root.getBoundingClientRect().top +
          root.scrollTop
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(content)
    observer.observe(root)
    return () => observer.disconnect()
  }, [getScrollElement])

  const rows = virtualizer.getVirtualItems()
  return (
    <ul
      ref={listRef}
      className={className}
      data-virtual-prototype
      data-loaded-rows={rowKeys.length}
      data-mounted-rows={rows.length}
      style={{ gridTemplateRows: `repeat(${rowKeys.length}, 52px)` }}
    >
      {rows.map((row) => (
        <li
          key={row.key}
          className="col-span-full grid grid-cols-subgrid"
          style={{ gridRow: row.index + 1 }}
          aria-posinset={row.index + 1}
          aria-setsize={rowKeys.length}
          onFocusCapture={() => setFocusedIndex(row.index)}
        >
          {children(row.index)}
        </li>
      ))}
    </ul>
  )
}

export function AutoLoadPrototype({
  cursor,
  enabled,
  loadMore,
  children
}: {
  cursor: string | null
  enabled: boolean
  loadMore: () => void
  children: ReactNode
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const requestedCursor = useRef<string | null>(null)
  useEffect(() => {
    const element = sentinel.current
    if (!element || !enabled || cursor === null) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || requestedCursor.current === cursor) return
        requestedCursor.current = cursor
        loadMore()
      },
      {
        root: element.closest("[data-scroll-root]"),
        rootMargin: "0px 0px 1200px 0px"
      }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [cursor, enabled, loadMore])
  return (
    <div ref={sentinel} className="flex justify-center py-2">
      {children}
    </div>
  )
}

import { AnimatePresence, motion } from "motion/react"
import type { ComponentType, ReactNode } from "react"
import { Fragment, useLayoutEffect, useRef, useState } from "react"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { SegmentedIndicator } from "./SegmentedIndicator"

type IconCmp = ComponentType<{ className?: string; strokeWidth?: number }>

export type SegmentedItem<K extends string> = {
  key: K
  label: string
  icon?: IconCmp
  iconClassName?: string
  badge?: number | string | null
  badgeNode?: ReactNode
  compactAriaLabel?: string
}

export type SegmentedVariant = "default" | "inline"

type VariantTokens = {
  container: string
  innerGap: string
  innerGapPx: number
  iconSize: string
  pillRounding: string
  itemBase: string
}

const VARIANTS: Record<SegmentedVariant, VariantTokens> = {
  default: {
    container:
      "inline-flex items-center gap-0.5 rounded-xl border border-border bg-background p-1",
    innerGap: "gap-1.5",
    innerGapPx: 6,
    iconSize: "size-3.5",
    pillRounding: "rounded-lg",
    itemBase: "h-7 rounded-lg px-2.5 text-sm"
  },
  inline: {
    container: "inline-flex items-center gap-0.5",
    innerGap: "gap-1",
    innerGapPx: 4,
    iconSize: "size-3",
    pillRounding: "rounded-md",
    itemBase: "h-6 rounded-md px-1.5 text-xs"
  }
}

export interface SegmentedTabsProps<K extends string> {
  items: ReadonlyArray<SegmentedItem<K>>
  isActive: (key: K) => boolean
  renderItem: (
    item: SegmentedItem<K>,
    content: ReactNode,
    args: { active: boolean }
  ) => ReactNode
  compact?: boolean
  variant?: SegmentedVariant
  className?: string
}

export function SegmentedTabs<K extends string>({
  items,
  isActive,
  renderItem,
  compact = false,
  variant = "default",
  className
}: SegmentedTabsProps<K>) {
  const v = VARIANTS[variant]
  return (
    <div className={cn("relative", v.container, className)}>
      <SegmentedIndicator
        activeIndex={items.findIndex((item) => isActive(item.key))}
        className={cn("bg-accent", v.pillRounding)}
      />
      {items.map((it) => {
        const active = isActive(it.key)
        const Icon = it.icon
        const content = (
          <>
            <span
              className={cn(
                "relative z-10 inline-flex items-center",
                v.innerGap
              )}
            >
              {Icon && (
                <Icon
                  className={cn(v.iconSize, it.iconClassName)}
                  strokeWidth={1.75}
                />
              )}
              <CollapsingLabel show={!compact} gap={v.innerGapPx}>
                {it.label}
              </CollapsingLabel>
              {it.badgeNode ??
                (it.badge !== undefined && it.badge !== null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 font-mono text-[10px] tabular-nums",
                      active
                        ? "bg-foreground/10 text-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {it.badge}
                  </span>
                ))}
            </span>
          </>
        )
        return (
          <Fragment key={it.key}>
            {renderItem(it, content, { active })}
          </Fragment>
        )
      })}
    </div>
  )
}

export function CollapsingLabel({
  show,
  children,
  contentKey,
  gap = 8
}: {
  show: boolean
  children: ReactNode
  contentKey?: string | number
  gap?: number
}) {
  const innerRef = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState<number | "auto">("auto")

  useLayoutEffect(() => {
    if (innerRef.current) {
      setWidth(innerRef.current.scrollWidth)
    }
  }, [show, contentKey])

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          key="label"
          initial={{ width: 0, opacity: 0, marginLeft: -gap }}
          animate={{ width, opacity: 1, marginLeft: 0 }}
          exit={{ width: 0, opacity: 0, marginLeft: -gap }}
          transition={transitions.presence}
          className="inline-flex items-center overflow-hidden whitespace-nowrap"
        >
          <span ref={innerRef} className="inline-flex shrink-0 items-center">
            <AnimatePresence initial={false} mode="popLayout">
              <motion.span
                key={contentKey ?? "content"}
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                transition={transitions.presence}
                className="inline-flex items-center"
              >
                {children}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.span>
      )}
    </AnimatePresence>
  )
}

// Shared item button styling. Exported so callsites that render plain
// buttons get the exact same hit-target sizing and active/inactive text
// treatment as the URL-driven tabs. Pass the same `variant` you passed to
// SegmentedTabs so chrome and item sizing stay in sync.
export const SEGMENTED_ITEM_CLASS = (
  active: boolean,
  variant: SegmentedVariant = "default"
) =>
  cn(
    "group/seg-item relative inline-flex items-center transition-all duration-100 active:scale-[0.97]",
    VARIANTS[variant].itemBase,
    VARIANTS[variant].innerGap,
    active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
  )

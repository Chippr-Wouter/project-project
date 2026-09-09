import { motion } from "motion/react"
import { createContext, use, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { transitions } from "@/lib/springs"
type ControlsLayout = {
  layout: "hug" | "fill"
  measured: boolean
  compact: boolean
  controlsCompact: boolean
  setSearchActive: (active: boolean) => void
}
export const ControlsLayoutContext = createContext<ControlsLayout | null>(null)
export function useControlsLayout() {
  const value = use(ControlsLayoutContext)
  if (!value)
    throw new Error("Toolbar controls must render inside Toolbar.Root")
  return value
}

export const TOOLBAR_BUTTON_CLASS = cn(
  "inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-sm",
  "text-muted-foreground transition-all duration-100 hover:text-foreground active:scale-[0.97]",
  "ring-offset-background focus-visible:ring-2 focus-visible:ring-ring outline-none"
)

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-1 pb-0.5 text-[11px] text-muted-foreground">
      {children}
    </div>
  )
}

export function FilterSection({ children }: { children: ReactNode }) {
  return (
    <div className="[&:not(:first-child)]:mt-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border [&:not(:first-child)]:pt-1">
      {children}
    </div>
  )
}

export function ControlSlot({ children }: { children: ReactNode }) {
  const { layout } = useControlsLayout()
  return (
    <motion.div
      layout="position"
      transition={transitions.layout}
      className={cn(layout === "fill" && "min-w-0 flex-1")}
    >
      {children}
    </motion.div>
  )
}

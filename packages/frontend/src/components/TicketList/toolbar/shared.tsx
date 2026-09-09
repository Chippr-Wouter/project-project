import { motion } from "motion/react"
import type { ReactNode } from "react"
import { transitions } from "@/lib/springs"
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
  return (
    <motion.div layout="position" transition={transitions.layout}>
      {children}
    </motion.div>
  )
}

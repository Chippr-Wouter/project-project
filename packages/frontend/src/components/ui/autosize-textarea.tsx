import type { ComponentProps } from "react"
import { cn } from "@/lib/utils"

export function AutosizeTextarea({
  className,
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(
        "block w-full min-w-0 min-h-[1lh] resize-none field-sizing-content whitespace-pre-wrap [overflow-wrap:anywhere]",
        className
      )}
    />
  )
}

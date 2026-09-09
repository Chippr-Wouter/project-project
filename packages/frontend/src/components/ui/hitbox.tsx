import { forwardRef, type ButtonHTMLAttributes } from "react"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

type Margin = "1" | "2" | "3" | "4"
type Mode = "inline" | "absolute"

const MARGIN: Record<Margin, string> = {
  "1": "before:-inset-1",
  "2": "before:-inset-2",
  "3": "before:-inset-3",
  "4": "before:-inset-4"
}

interface HitboxProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  mode?: Mode
  margin?: Margin
}

export const Hitbox = forwardRef<HTMLButtonElement, HitboxProps>(
  ({ mode = "inline", margin = "2", className, children, ...rest }, ref) => {
    const shape = useShape()
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "group/hitbox cursor-pointer outline-none before:absolute before:content-[''] focus-visible:ring-1 focus-visible:ring-ring",
          shape.button,
          mode === "absolute"
            ? "absolute inset-0"
            : "relative inline-flex items-center",
          MARGIN[margin],
          className
        )}
        {...rest}
      >
        {children}
      </button>
    )
  }
)
Hitbox.displayName = "Hitbox"

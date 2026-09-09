import { forwardRef, type ButtonHTMLAttributes } from "react"
import { useShape } from "@/lib/shape-context"
import { cn } from "@/lib/utils"

type Margin = "1" | "2" | "3" | "4"
type Mode = "inline" | "absolute"

const MARGIN: Record<Margin, string> = {
  "1": "-m-1 p-1",
  "2": "-m-2 p-2",
  "3": "-m-3 p-3",
  "4": "-m-4 p-4"
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
          "group/hitbox cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring",
          shape.button,
          mode === "absolute" ? "absolute inset-0" : "inline-flex items-center",
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

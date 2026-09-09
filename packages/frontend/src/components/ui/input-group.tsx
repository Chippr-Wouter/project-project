import * as React from "react"
import { cn } from "@/lib/utils"

function InputGroup({
  className,
  onMouseDown,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      onMouseDown={(e) => {
        onMouseDown?.(e)
        if (e.defaultPrevented) return
        const target = e.target as HTMLElement
        if (
          target.closest(
            "button, [role='button'], a, input, textarea, select, [contenteditable='true']"
          )
        ) {
          return
        }
        const input = e.currentTarget.querySelector<HTMLInputElement>("input")
        if (!input || input === document.activeElement) return
        e.preventDefault()
        input.focus()
      }}
      className={cn(
        "group/input-group relative flex h-9 w-full cursor-text items-center gap-2 rounded-xl border border-border bg-background px-3 transition-[color,box-shadow]",
        "ring-offset-background focus-within:ring-2 focus-within:ring-ring",
        "has-[input:disabled]:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input-group-input"
      className={cn(
        "flex-1 min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn(
        "grid size-6 shrink-0 place-items-center text-muted-foreground transition-colors",
        className
      )}
      {...props}
    />
  )
}

function InputGroupHint({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-hint"
      className={cn("shrink-0 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export { InputGroup, InputGroupAddon, InputGroupInput, InputGroupHint }

import * as React from "react"
import { flushSync } from "react-dom"
import { mergeProps } from "@base-ui/react/merge-props"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

const DeferMenusContext = React.createContext(false)
const DeferredMenuContext = React.createContext<{
  handle: ReturnType<typeof MenuPrimitive.createHandle>
  mounted: boolean
  activate: () => void
  rootProps: React.ComponentProps<typeof MenuPrimitive.Root>
} | null>(null)

function DeferredDropdownMenus({ children }: { children: React.ReactNode }) {
  return <DeferMenusContext value>{children}</DeferMenusContext>
}

function DropdownMenu(props: React.ComponentProps<typeof MenuPrimitive.Root>) {
  const defer = React.useContext(DeferMenusContext)
  return defer && !props.handle && typeof props.children !== "function" ? (
    <DeferredDropdownMenu {...props}>{props.children}</DeferredDropdownMenu>
  ) : (
    <MenuPrimitive.Root {...props} />
  )
}

function DeferredDropdownMenu({
  children,
  ...rootProps
}: Omit<React.ComponentProps<typeof MenuPrimitive.Root>, "children"> & {
  children: React.ReactNode
}) {
  const [handle] = React.useState(() => MenuPrimitive.createHandle())
  const [mounted, setMounted] = React.useState(
    Boolean(rootProps.open ?? rootProps.defaultOpen)
  )
  const activate = React.useCallback(() => {
    if (!mounted) flushSync(() => setMounted(true))
  }, [mounted])
  return (
    <DeferredMenuContext
      value={{
        handle,
        mounted: mounted || rootProps.open === true,
        activate,
        rootProps
      }}
    >
      {children}
    </DeferredMenuContext>
  )
}

function DropdownMenuPortal({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Portal>) {
  return <MenuPrimitive.Portal {...props} />
}

function DropdownMenuTrigger(
  props: React.ComponentProps<typeof MenuPrimitive.Trigger>
) {
  const deferred = React.useContext(DeferredMenuContext)
  return (
    <MenuPrimitive.Trigger
      {...mergeProps(
        props,
        deferred
          ? {
              handle: deferred.handle,
              onPointerEnter: deferred.activate,
              onFocus: deferred.activate,
              onPointerDownCapture: deferred.activate,
              onKeyDownCapture: deferred.activate,
              onClickCapture: deferred.activate
            }
          : {}
      )}
      data-slot="dropdown-menu-trigger"
    />
  )
}

type DropdownMenuContentProps = React.ComponentProps<
  typeof MenuPrimitive.Popup
> &
  Pick<
    React.ComponentProps<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >

function DropdownMenuContent(props: DropdownMenuContentProps) {
  const deferred = React.useContext(DeferredMenuContext)
  if (!deferred) return <DropdownMenuPopup {...props} />
  if (!deferred.mounted) return null
  return (
    <DeferredMenuContext value={null}>
      <MenuPrimitive.Root {...deferred.rootProps} handle={deferred.handle}>
        <DropdownMenuPopup {...props} />
      </MenuPrimitive.Root>
    </DeferredMenuContext>
  )
}

function DropdownMenuPopup({
  className,
  align,
  alignOffset,
  side,
  sideOffset = 4,
  anchor,
  onClick,
  onKeyDown,
  ...props
}: DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          onClick={(event) => {
            onClick?.(event)
            event.stopPropagation()
          }}
          onKeyDown={(event) => {
            onKeyDown?.(event)
            event.stopPropagation()
          }}
          className={cn(
            "z-50 max-h-[var(--available-height)] min-w-[8rem] origin-[var(--transform-origin)] overflow-x-hidden overflow-y-auto rounded-xl border border-border/60 bg-card p-1 text-foreground select-none shadow-[0_4px_12px_rgba(0,0,0,0.02)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[13px] text-muted-foreground outline-hidden transition-colors",
        "data-[highlighted]:bg-accent/40 dark:data-[highlighted]:bg-accent/25 data-[highlighted]:text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[inset]:pl-8",
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/10 data-[variant=destructive]:data-[highlighted]:text-destructive dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/20",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:transition-[stroke-width,color] [&_svg]:duration-80 data-[highlighted]:[&_svg]:stroke-[2]",
        "data-[variant=destructive]:*:[svg]:text-destructive!",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md py-2 pr-2 pl-8 text-[13px] text-muted-foreground outline-hidden transition-colors",
        "data-[highlighted]:bg-accent/40 dark:data-[highlighted]:bg-accent/25 data-[highlighted]:text-foreground",
        "data-[checked]:text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioGroup>) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "relative flex cursor-pointer items-center gap-2 rounded-md py-2 pr-2 pl-8 text-[13px] text-muted-foreground outline-hidden transition-colors",
        "data-[highlighted]:bg-accent/40 dark:data-[highlighted]:bg-accent/25 data-[highlighted]:text-foreground",
        "data-[checked]:text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.GroupLabel> & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-[11px] text-muted-foreground data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border/60", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuRoot>) {
  return <MenuPrimitive.SubmenuRoot {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-[13px] text-muted-foreground outline-hidden transition-colors",
        "data-[highlighted]:bg-accent/40 dark:data-[highlighted]:bg-accent/25 data-[highlighted]:text-foreground",
        "data-[popup-open]:bg-accent/40 data-[popup-open]:text-foreground",
        "data-[inset]:pl-8",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

type DropdownMenuSubContentProps = React.ComponentProps<
  typeof MenuPrimitive.Popup
> &
  Pick<
    React.ComponentProps<typeof MenuPrimitive.Positioner>,
    "align" | "alignOffset" | "side" | "sideOffset"
  >

function DropdownMenuSubContent({
  className,
  align,
  alignOffset,
  side,
  sideOffset,
  ...props
}: DropdownMenuSubContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(
            "z-50 min-w-[8rem] origin-[var(--transform-origin)] overflow-hidden rounded-xl border border-border/60 bg-card p-1 text-foreground shadow-[0_4px_12px_rgba(0,0,0,0.02)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.5)] data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95 data-[open]:animate-in data-[open]:fade-in-0 data-[open]:zoom-in-95",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export {
  DeferredDropdownMenus,
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent
}

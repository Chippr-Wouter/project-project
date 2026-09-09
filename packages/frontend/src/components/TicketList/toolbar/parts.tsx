import { AnimatePresence, motion } from "motion/react"
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  Circle,
  Search as SearchIcon,
  X
} from "lucide-react"
import type { ReactNode } from "react"
import { CollapsingLabel } from "@/components/SegmentedTabs"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from "@/components/ui/input-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { boardStatusesFor } from "@/components/sprints/board-utils"
import { statusMetaFor, statusLabelFor } from "@/lib/ticket-meta"
import { useGlobalShortcut } from "@/lib/use-global-shortcut"
import { cn } from "@/lib/utils"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"
import type { SortKey, TicketStatus } from "@projectproject/shared"
import { SORT_LABELS } from "../sort"
import {
  ControlsLayoutProvider,
  useControlsLayout,
  useToolbar
} from "./context"
import { ControlSlot, TOOLBAR_BUTTON_CLASS } from "./shared"

export function Root({ children }: { children: ReactNode }) {
  const {
    meta: { containerRef }
  } = useToolbar()
  return (
    <div
      ref={containerRef}
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
    >
      {children}
    </div>
  )
}

export function Controls({
  layout = "hug",
  children
}: {
  layout?: "hug" | "fill"
  children: ReactNode
}) {
  const {
    state: { measured }
  } = useToolbar()
  if (!measured) return null
  return (
    <ControlsLayoutProvider value={layout}>
      <div
        className={cn(
          "relative flex flex-wrap items-center gap-2",
          layout === "fill" && "flex-1 basis-[220px]"
        )}
      >
        {children}
      </div>
    </ControlsLayoutProvider>
  )
}

export function Search() {
  const {
    state: { searchInput, compact, searchBelowMinChars },
    actions: { setSearchQuery, setSearchFocused, flushSearch, clearSearch },
    meta: { searchRef }
  } = useToolbar()
  useGlobalShortcut("/", searchRef)
  return (
    <InputGroup className="min-w-0 flex-1 basis-[220px]">
      <InputGroupAddon>
        <SearchIcon className="size-4" strokeWidth={1.75} />
      </InputGroupAddon>
      <InputGroupInput
        ref={searchRef}
        value={searchInput}
        onChange={(e) => setSearchQuery(e.target.value)}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => {
          setSearchFocused(false)
          flushSearch()
        }}
        placeholder={m.tickets_search_placeholder()}
        aria-label={m.tickets_search_aria_label()}
      />
      {searchBelowMinChars ? (
        <span className="shrink-0 text-xs text-muted-foreground">
          {m.tickets_search_min_hint()}
        </span>
      ) : null}
      {searchInput ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={clearSearch}
          aria-label={m.tickets_search_clear_aria_label()}
          className="shrink-0 rounded-xl"
        >
          <X strokeWidth={1.75} />
        </Button>
      ) : !compact ? (
        <Kbd>/</Kbd>
      ) : null}
    </InputGroup>
  )
}

export function Status() {
  const {
    state: { status, counts, statuses, controlsCompact },
    actions: { setStatus }
  } = useToolbar()
  const layout = useControlsLayout()
  const stretch = layout === "fill"
  const slugs = boardStatusesFor(statuses)
  const active = status !== "all"
  const currentMeta = active ? statusMetaFor(status, statuses) : null
  const currentLabel = active
    ? statusLabelFor(status, statuses)
    : m.tickets_status_all()
  const CurrentIcon = currentMeta?.icon ?? Circle

  return (
    <ControlSlot>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                TOOLBAR_BUTTON_CLASS,
                stretch && "w-full",
                active && "bg-accent text-foreground hover:text-foreground"
              )}
              aria-label={m.tickets_status_aria_label({ label: currentLabel })}
              aria-pressed={active}
            >
              <CurrentIcon
                className={cn("size-4", currentMeta?.className)}
                style={
                  currentMeta?.color ? { color: currentMeta.color } : undefined
                }
                strokeWidth={1.75}
              />
              <CollapsingLabel show={!controlsCompact}>
                {currentLabel}
              </CollapsingLabel>
              <span
                className={cn(
                  "min-w-6 rounded-full px-1.5 text-center font-mono text-[10px] tabular-nums",
                  active
                    ? "bg-foreground/10 text-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {counts[status] ?? 0}
              </span>
              <ChevronDown
                className={cn("size-3.5 opacity-60", stretch && "ml-auto")}
                strokeWidth={1.75}
              />
            </button>
          }
        />
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-52"
          finalFocus={false}
        >
          <DropdownMenuItem
            onClick={() => setStatus("all")}
            className="cursor-pointer"
          >
            <Circle
              className="size-4 text-muted-foreground"
              strokeWidth={1.75}
            />
            <span>{m.tickets_status_all()}</span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                {counts.all ?? 0}
              </span>
              {status === "all" && (
                <Check className="size-3.5 text-muted-foreground" />
              )}
            </span>
          </DropdownMenuItem>
          {slugs.length > 0 && <div className="my-1 h-px bg-border" />}
          {slugs.map((s) => {
            const meta = statusMetaFor(s, statuses)
            const SIcon = meta.icon
            return (
              <DropdownMenuItem
                key={s}
                onClick={() => setStatus(s as TicketStatus)}
                className="cursor-pointer"
              >
                <SIcon
                  className={cn("size-4", meta.className)}
                  style={meta.color ? { color: meta.color } : undefined}
                  strokeWidth={1.75}
                />
                <span className="truncate">{statusLabelFor(s, statuses)}</span>
                <span className="ml-auto inline-flex items-center gap-2">
                  <span className="rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {counts[s] ?? 0}
                  </span>
                  {status === s && (
                    <Check className="size-3.5 text-muted-foreground" />
                  )}
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </ControlSlot>
  )
}

export function Sort() {
  const {
    state: { sortKey, controlsCompact },
    actions: { setSortKey }
  } = useToolbar()
  return (
    <motion.div layout="position" transition={transitions.layout}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={TOOLBAR_BUTTON_CLASS}
              aria-label={m.tickets_sort_aria_label({
                label: SORT_LABELS[sortKey]()
              })}
            >
              <ArrowDownAZ className="size-4" strokeWidth={1.75} />
              <CollapsingLabel show={!controlsCompact}>
                {SORT_LABELS[sortKey]()}
              </CollapsingLabel>
              <ChevronDown className="size-3.5 opacity-60" strokeWidth={1.75} />
            </button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={6} className="w-44">
          {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
            <DropdownMenuItem
              key={k}
              onClick={() => setSortKey(k)}
              className="cursor-pointer"
            >
              {SORT_LABELS[k]()}
              {sortKey === k && (
                <Check className="ml-auto size-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.div>
  )
}

export function ClearAll() {
  const {
    state: { hasActiveFilters },
    actions: { clearAll }
  } = useToolbar()
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {hasActiveFilters && (
        <motion.button
          key="clear"
          type="button"
          onClick={clearAll}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={transitions.pop}
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-destructive/40 bg-destructive/10 text-destructive transition-colors duration-100 active:scale-[0.97]",
            "hover:bg-destructive/15 hover:border-destructive/60",
            "ring-offset-background focus-visible:ring-2 focus-visible:ring-ring outline-none"
          )}
          title={m.tickets_filters_clear_all()}
          aria-label={m.tickets_filters_clear_all()}
        >
          <X className="size-4 shrink-0" strokeWidth={1.75} />
        </motion.button>
      )}
    </AnimatePresence>
  )
}

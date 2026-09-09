import { AnimatePresence, motion } from "motion/react"
import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  Circle,
  Search as SearchIcon,
  X
} from "lucide-react"
import { useRef } from "react"
import { useAtomValue } from "@effect/atom-react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { projectStatusesAtom, projectKey } from "@/atoms/projectStatuses"
import { MIN_SEARCH_CHARS } from "../search"
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
import {
  type SortKey,
  NATURAL_SORT_DIR,
  type TicketStatus
} from "@projectproject/shared"
import { useTicketToolbar } from "./context"
import { SORT_LABELS } from "../sort"
import { ControlSlot, ToolbarButton } from "./shared"

export function SearchInput() {
  const { search, searchActive: compact, setFocused } = useTicketToolbar()
  const searchInput = search.draft
  const searchRef = useRef<HTMLInputElement>(null)
  const searchBelowMinChars =
    searchInput.length > 0 && searchInput.length < MIN_SEARCH_CHARS
  useGlobalShortcut("/", searchRef)
  return (
    <InputGroup className="min-w-0 flex-1 basis-[220px]">
      <InputGroupAddon>
        <SearchIcon className="size-4" strokeWidth={1.75} />
      </InputGroupAddon>
      <InputGroupInput
        ref={searchRef}
        value={searchInput}
        onChange={(e) => search.change(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false)
          search.flush()
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
          onClick={search.clear}
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
  const { query, patchFilter, counts, orgSlug, slug, controlsCompact } =
    useTicketToolbar()
  const selected = query.filter?.status
  const status = selected?.length === 1 ? selected[0] : "all"
  const setStatus = (status: TicketStatus | "all") =>
    patchFilter({ status: status === "all" ? undefined : [status] })
  const result = useAtomValue(projectStatusesAtom(projectKey(orgSlug, slug)))
  const statuses = Result.isSuccess(result) ? result.value : []
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
            <ToolbarButton
              active={active}
              aria-label={m.tickets_status_aria_label({ label: currentLabel })}
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
              <ChevronDown className="size-3.5 opacity-60" strokeWidth={1.75} />
            </ToolbarButton>
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
  const { query, onQueryChange, controlsCompact } = useTicketToolbar()
  const sortKey = query.sort.key
  const setSortKey = (key: SortKey) =>
    onQueryChange({ ...query, sort: { key, dir: NATURAL_SORT_DIR[key] } })
  return (
    <motion.div layout="position" transition={transitions.layout}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <ToolbarButton
              aria-label={m.tickets_sort_aria_label({
                label: SORT_LABELS[sortKey]()
              })}
            >
              <ArrowDownAZ className="size-4" strokeWidth={1.75} />
              <CollapsingLabel show={!controlsCompact}>
                {SORT_LABELS[sortKey]()}
              </CollapsingLabel>
              <ChevronDown className="size-3.5 opacity-60" strokeWidth={1.75} />
            </ToolbarButton>
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
  const { hasActiveFilters, clearAll } = useTicketToolbar()
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

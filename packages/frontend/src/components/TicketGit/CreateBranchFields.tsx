import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Match from "effect/Match"
import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  CircleCheck,
  GitBranch
} from "lucide-react"
import { useEffect, useState } from "react"
import { branchesAtom, branchesKey, createBranchAtom } from "@/atoms/github"
import { projectKey } from "@/atoms/projects"
import { ticketKey, updateTicketAtom } from "@/atoms/tickets"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { InlineForm, useInlineForm } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import {
  SEGMENTED_ITEM_CLASS,
  SegmentedTabs,
  type SegmentedItem
} from "@/components/SegmentedTabs"
import { cn } from "@/lib/utils"
import { slugify } from "@/lib/slug"
import { statusMetaFor, statusLabelFor } from "@/lib/ticket-meta"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { boardStatusesFor } from "@/components/sprints/board-utils"
import { m } from "@/paraglide/messages"
import type {
  GithubConnection,
  ProjectStatus,
  TicketDetail,
  TicketStatus
} from "@projectproject/shared"

const STATUS_SEGMENTED_THRESHOLD = 4

function defaultBranchName(
  template: string | null,
  type: string,
  id: string,
  title: string
): string {
  const tpl = template ?? "{type}/{id}-{slug}"
  return tpl
    .replace("{type}", type)
    .replace("{id}", id)
    .replace("{slug}", slugify(title))
}

export function CreateBranchFields({
  orgSlug,
  slug,
  ticket,
  github,
  branchTemplate,
  variant = "bordered"
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
  github: GithubConnection
  branchTemplate: string | null
  variant?: "bordered" | "ghost"
}) {
  const buttonSize = variant === "bordered" ? "sm" : "xs"
  const { busy, setBusy, close } = useInlineForm()
  const [name, setName] = useState(() =>
    defaultBranchName(branchTemplate, ticket.type, ticket.id, ticket.title)
  )
  const [base, setBase] = useState(github.defaultBaseBranch ?? "")
  const [status, setStatus] = useState<TicketStatus>(
    "in_progress" as TicketStatus
  )
  const [didSubmit, setDidSubmit] = useState(false)
  const [attemptedName, setAttemptedName] = useState("")
  const pKey = projectKey(orgSlug, slug)
  const create = useAtomSet(createBranchAtom(pKey), { mode: "promiseExit" })
  const createState = useAtomValue(createBranchAtom(pKey))
  const updateTicket = useAtomSet(
    updateTicketAtom(ticketKey(orgSlug, slug, ticket.id))
  )
  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const statuses = Result.isSuccess(statusesResult) ? statusesResult.value : []

  const errorString =
    didSubmit && !createState.waiting
      ? Result.matchWithError(createState, {
          onInitial: () => null,
          onSuccess: () => null,
          onError: (error) =>
            Match.value(error).pipe(
              Match.tag("BranchExists", () =>
                m.git_branch_exists_error({ name: attemptedName })
              ),
              Match.tag("BranchProtected", () =>
                m.git_branch_protected_error()
              ),
              Match.tag("GitHubTokenExpired", () =>
                m.git_github_token_expired_error()
              ),
              Match.tag("GitHubScopeInsufficient", () =>
                m.git_github_scope_insufficient_error()
              ),
              Match.tag("RepoGone", () => m.git_repo_gone_error()),
              Match.orElse(() => m.git_create_branch_error())
            ),
          onDefect: () => m.git_create_branch_error()
        })
      : null

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setDidSubmit(true)
    const branchName = name.trim()
    const baseBranch = base.trim() || github.defaultBaseBranch || "main"
    setAttemptedName(branchName)
    const exit = await create({
      id: ticket.id,
      name: branchName,
      baseBranch
    })
    if (Exit.isSuccess(exit)) {
      if (status !== ticket.status) updateTicket({ status })
      close()
    } else {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grid gap-2 @sm/git-panel:grid-cols-[1fr_220px]">
        <label className="block text-xs">
          <span className="text-muted-foreground">
            {m.git_branch_name_label()}
          </span>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-0.5 font-mono"
            placeholder={defaultBranchName(
              null,
              ticket.type,
              ticket.id,
              ticket.title
            )}
            disabled={busy}
          />
        </label>
        <label className="block text-xs">
          <span className="text-muted-foreground">
            {m.git_base_branch_label()}
          </span>
          <BaseBranchCombobox
            orgSlug={orgSlug}
            slug={slug}
            repoId={github.repoId}
            value={base}
            onChange={setBase}
            placeholder={github.defaultBaseBranch ?? "main"}
            disabled={busy}
          />
        </label>
      </div>
      {errorString && (
        <p className="text-xs text-destructive" role="alert">
          {errorString}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 @max-sm/git-panel:flex-col @max-sm/git-panel:items-stretch">
        <StatusPicker
          value={status}
          onChange={setStatus}
          disabled={busy}
          statuses={statuses}
        />
        <div className="flex gap-2 @max-sm/git-panel:justify-end">
          <InlineForm.Cancel size={buttonSize} />
          <Button
            size={buttonSize}
            leadingIcon={CircleCheck}
            onClick={() => void submit()}
            disabled={busy || !name.trim()}
          >
            {busy
              ? m.git_create_branch_in_progress()
              : m.git_create_branch_button()}
          </Button>
        </div>
      </div>
    </>
  )
}

function StatusPicker({
  value,
  onChange,
  disabled,
  statuses
}: {
  value: TicketStatus
  onChange: (next: TicketStatus) => void
  disabled?: boolean
  statuses: ReadonlyArray<ProjectStatus>
}) {
  const slugs = boardStatusesFor(statuses)
  const segmented = slugs.length <= STATUS_SEGMENTED_THRESHOLD
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{m.git_update_status_label()}</span>
      {segmented ? (
        <StatusInlinePills
          value={value}
          onChange={onChange}
          disabled={disabled}
          statuses={statuses}
          slugs={slugs}
        />
      ) : (
        <StatusDropdown
          value={value}
          onChange={onChange}
          disabled={disabled}
          statuses={statuses}
          slugs={slugs}
        />
      )}
    </div>
  )
}

function StatusInlinePills({
  value,
  onChange,
  disabled,
  statuses,
  slugs
}: {
  value: TicketStatus
  onChange: (next: TicketStatus) => void
  disabled?: boolean
  statuses: ReadonlyArray<ProjectStatus>
  slugs: ReadonlyArray<string>
}) {
  const items: ReadonlyArray<SegmentedItem<string>> = slugs.map((key) => {
    const sMeta = statusMetaFor(key, statuses)
    return {
      key,
      label: statusLabelFor(key, statuses),
      icon: sMeta.icon,
      iconClassName: sMeta.className
    }
  })
  return (
    <SegmentedTabs
      items={items}
      variant="inline"
      isActive={(k) => k === value}
      renderItem={(item, content, { active }) => (
        <button
          type="button"
          onClick={() => onChange(item.key as TicketStatus)}
          disabled={disabled}
          aria-pressed={active}
          className={cn(
            SEGMENTED_ITEM_CLASS(active, "inline"),
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        >
          {content}
        </button>
      )}
    />
  )
}

function StatusDropdown({
  value,
  onChange,
  disabled,
  statuses,
  slugs
}: {
  value: TicketStatus
  onChange: (next: TicketStatus) => void
  disabled?: boolean
  statuses: ReadonlyArray<ProjectStatus>
  slugs: ReadonlyArray<string>
}) {
  const current = statusMetaFor(value, statuses)
  const Icon = current.icon
  const currentLabel = statusLabelFor(value, statuses)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            aria-label={m.git_status_select_aria_label({
              status: currentLabel
            })}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs",
              "text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            <Icon
              className={cn("size-3", current.className)}
              style={current.color ? { color: current.color } : undefined}
              strokeWidth={1.75}
            />
            <span>{currentLabel}</span>
            <ChevronDown className="size-3 opacity-60" strokeWidth={1.75} />
          </button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6} className="w-44">
        {slugs.map((key) => {
          const meta = statusMetaFor(key, statuses)
          const SIcon = meta.icon
          return (
            <DropdownMenuItem
              key={key}
              onClick={() => onChange(key as TicketStatus)}
              className="cursor-pointer"
            >
              <SIcon
                className={cn("size-4", meta.className)}
                style={meta.color ? { color: meta.color } : undefined}
                strokeWidth={1.75}
              />
              {statusLabelFor(key, statuses)}
              {value === key && (
                <Check className="ml-auto size-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BaseBranchCombobox({
  orgSlug,
  slug,
  repoId,
  value,
  onChange,
  placeholder,
  disabled
}: {
  orgSlug: string
  slug: string
  repoId: string
  value: string
  onChange: (next: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")

  useEffect(() => {
    const fiber = Effect.runFork(
      Effect.sleep(200).pipe(Effect.tap(() => Effect.sync(() => setQ(search))))
    )
    return () => {
      Effect.runFork(Fiber.interrupt(fiber))
    }
  }, [search])

  const result = useAtomValue(
    branchesAtom(branchesKey(orgSlug, slug, repoId, q))
  )
  const items = Result.isSuccess(result) ? result.value.items : []
  const loading = Result.isInitial(result) || Result.isWaiting(result)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "mt-0.5 flex h-9 w-full items-center justify-between rounded-xl border border-border bg-background px-3 font-mono text-xs",
              "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
              !value && "text-muted-foreground"
            )}
          >
            <span className="truncate">{value || placeholder}</span>
            <ChevronsUpDown className="size-3 shrink-0 opacity-50" />
          </button>
        }
      />
      <PopoverContent
        align="start"
        className="w-[--radix-popover-trigger-width] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={m.git_search_branches_placeholder()}
            value={search}
            onValueChange={setSearch}
            className="h-8"
          />
          <CommandList>
            {loading ? (
              <CommandEmpty>{m.git_branches_loading()}</CommandEmpty>
            ) : items.length === 0 ? (
              <CommandEmpty>{m.git_no_branches_found()}</CommandEmpty>
            ) : (
              <CommandGroup>
                {items.map((b) => (
                  <CommandItem
                    key={b.name}
                    value={b.name}
                    onSelect={(picked) => {
                      onChange(picked)
                      setOpen(false)
                    }}
                    className="font-mono text-xs"
                  >
                    <Check
                      className={cn(
                        "size-3",
                        value === b.name ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <GitBranch className="size-3" strokeWidth={1.75} />
                    <span className="truncate">{b.name}</span>
                    {b.isProtected && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {m.git_branch_protected_pill()}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

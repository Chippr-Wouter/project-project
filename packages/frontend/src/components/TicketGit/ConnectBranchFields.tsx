// Inline form body for "connect existing branch". Search input on top,
// scrollable result list below, footer with cancel + connect. Hand-rolled
// (no cmdk in this workspace) but keyboard-navigable.

import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useDebouncedValue } from "@tanstack/react-pacer"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import { GitBranch } from "lucide-react"
import { useRef, useState } from "react"
import { attachBranchAtom, branchesAtom, branchesKey } from "@/atoms/github"
import { projectKey } from "@/atoms/projects"
import { Button } from "@/components/ui/button"
import { InlineForm, useInlineForm } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import type {
  BranchListItem,
  GithubConnection,
  TicketDetail
} from "@projectproject/shared"

export interface BranchItemsCache {
  repoId: string
  items: readonly BranchListItem[]
  hasLoadedOnce: boolean
}

export function branchItemsView({
  repoId,
  cache,
  successItems,
  loading
}: {
  repoId: string
  cache: BranchItemsCache
  successItems: readonly BranchListItem[] | null
  loading: boolean
}) {
  const repoCache =
    cache.repoId === repoId
      ? cache
      : { repoId, items: [], hasLoadedOnce: false }
  const nextCache =
    successItems === null
      ? repoCache
      : { repoId, items: successItems, hasLoadedOnce: true }
  return {
    cache: nextCache,
    items: successItems ?? nextCache.items,
    showSkeleton: !nextCache.hasLoadedOnce && loading,
    isRefetching: nextCache.hasLoadedOnce && loading
  }
}

export function ConnectBranchFields({
  orgSlug,
  slug,
  ticket,
  github,
  variant = "bordered"
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
  github: GithubConnection
  variant?: "bordered" | "ghost"
}) {
  const buttonSize = variant === "bordered" ? "sm" : "xs"
  const { busy, setBusy, close } = useInlineForm()
  const [input, setInput] = useState("")
  const [q] = useDebouncedValue(input, { wait: 200 })
  const [selectedState, setSelectedState] = useState<{
    repoId: string
    name: string
  } | null>(null)
  const [activeState, setActiveState] = useState<{
    repoId: string
    index: number
  } | null>(null)
  const [didSubmit, setDidSubmit] = useState(false)
  const [attemptedName, setAttemptedName] = useState("")
  const selected =
    selectedState?.repoId === github.repoId ? selectedState.name : null
  const setSelected = (name: string | null) =>
    setSelectedState(name === null ? null : { repoId: github.repoId, name })
  const activeIdx =
    activeState?.repoId === github.repoId ? activeState.index : 0
  const setActiveIdx = (next: number | ((current: number) => number)) =>
    setActiveState((current) => {
      const currentIndex = current?.repoId === github.repoId ? current.index : 0
      const index = typeof next === "function" ? next(currentIndex) : next
      return { repoId: github.repoId, index }
    })

  const key = branchesKey(orgSlug, slug, github.repoId, q)
  const result = useAtomValue(branchesAtom(key))
  const refreshBranches = useAtomRefresh(branchesAtom(key))
  const pKey = projectKey(orgSlug, slug)
  const attach = useAtomSet(attachBranchAtom(pKey), { mode: "promiseExit" })
  const attachState = useAtomValue(attachBranchAtom(pKey))

  const itemsCacheRef = useRef<BranchItemsCache>({
    repoId: github.repoId,
    items: [],
    hasLoadedOnce: false
  })
  const isLoading =
    Result.isInitial(result) || Result.isWaiting(result) || input !== q
  const view = branchItemsView({
    repoId: github.repoId,
    cache: itemsCacheRef.current,
    successItems: Result.isSuccess(result) ? result.value.items : null,
    loading: isLoading
  })
  itemsCacheRef.current = view.cache
  const { items, showSkeleton, isRefetching } = view
  const clampedActiveIdx =
    items.length === 0 ? 0 : Math.min(activeIdx, items.length - 1)
  const listRef = useRef<HTMLDivElement>(null)

  const errorString =
    didSubmit && !attachState.waiting
      ? Result.matchWithError(attachState, {
          onInitial: () => null,
          onSuccess: () => null,
          onError: (error) =>
            Match.value(error).pipe(
              Match.tag("BranchNotFound", () =>
                m.git_branch_not_found_error({ name: attemptedName })
              ),
              Match.tag("GitHubTokenExpired", () =>
                m.git_github_token_expired_error()
              ),
              Match.tag("GitHubScopeInsufficient", () =>
                m.git_github_scope_insufficient_error()
              ),
              Match.tag("RepoGone", () => m.git_repo_gone_error()),
              Match.orElse(() => m.git_attach_branch_error())
            ),
          onDefect: () => m.git_attach_branch_error()
        })
      : null

  async function submit(branchName: string) {
    setBusy(true)
    setDidSubmit(true)
    setAttemptedName(branchName)
    const exit = await attach({
      id: ticket.id,
      name: branchName
    })
    if (Exit.isSuccess(exit)) {
      close()
      return
    }
    setBusy(false)
    // BranchNotFound: clear stale selection and refresh the branch list so
    // the picker reflects what the server now believes exists.
    const failure = Cause.findErrorOption(exit.cause)
    if (Option.isSome(failure) && failure.value._tag === "BranchNotFound") {
      setSelected(null)
      refreshBranches()
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = items[clampedActiveIdx]
      if (item) {
        setSelected(item.name)
        void submit(item.name)
      }
    }
  }

  return (
    <>
      <Input
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-8 font-mono"
        placeholder={m.git_search_branches_placeholder()}
        disabled={busy}
      />
      <div
        ref={listRef}
        className="max-h-48 overflow-hidden overflow-y-auto rounded-md border border-border bg-muted/30"
      >
        {showSkeleton ? (
          <div className="space-y-1 p-1">
            <div className="h-6 skeleton rounded bg-muted/60" />
            <div className="h-6 skeleton rounded bg-muted/60" />
            <div className="h-6 skeleton rounded bg-muted/60" />
          </div>
        ) : Result.isFailure(result) ? (
          <p className="p-2 text-xs text-destructive">
            {m.git_load_branches_error()}
          </p>
        ) : items.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            {m.git_no_branches_found()}
          </p>
        ) : (
          <ul
            role="listbox"
            className={cn(
              isRefetching && "animate-pulse [animation-duration:1s]"
            )}
          >
            {items.map((b, i) => (
              <li key={b.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected === b.name}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => setSelected(b.name)}
                  onDoubleClick={() => {
                    setSelected(b.name)
                    void submit(b.name)
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-2 py-1 text-left font-mono text-xs transition-colors",
                    selected === b.name
                      ? "bg-selected text-foreground font-medium"
                      : clampedActiveIdx === i && "bg-muted"
                  )}
                  disabled={busy}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <GitBranch className="size-3" strokeWidth={1.75} />
                    {b.name}
                  </span>
                  {b.isProtected && (
                    <span className="text-[10px] text-muted-foreground">
                      {m.git_branch_protected_pill()}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {errorString && (
        <p className="text-xs text-destructive" role="alert">
          {errorString}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <InlineForm.Cancel size={buttonSize} />
        <Button
          size={buttonSize}
          leadingIcon={GitBranch}
          onClick={() => selected && void submit(selected)}
          disabled={busy || !selected}
        >
          {busy
            ? m.git_connect_branch_in_progress()
            : m.git_connect_branch_button()}
        </Button>
      </div>
    </>
  )
}

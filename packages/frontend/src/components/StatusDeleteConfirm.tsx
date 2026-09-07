import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { Check, ChevronDown, Trash2 } from "lucide-react"
import { useState } from "react"
import type { ProjectStatus, StatusSlug } from "@projectproject/shared"
import { deleteStatusAtom, projectKey } from "@/atoms/projectStatuses"
import { ticketsCountAtom, ticketsCountKey } from "@/atoms/tickets"
import { Button } from "@/components/ui/button"
import { ConfirmButton, useConfirmButton } from "@/components/ui/confirm-button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { statusLabelFor, statusMetaFor } from "@/lib/ticket-meta"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

type Props = {
  status: ProjectStatus
  statuses: ReadonlyArray<ProjectStatus>
  orgSlug: string
  slug: string
}

export function StatusDeleteConfirm({
  status,
  statuses,
  orgSlug,
  slug
}: Props) {
  return (
    <ConfirmButton.Root>
      <ConfirmButton.Trigger
        variant="ghost"
        size="icon-sm"
        aria-label={m.tickets_status_delete_button()}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 strokeWidth={1.75} />
      </ConfirmButton.Trigger>
      <ConfirmButton.Confirm>
        <ConfirmBody
          status={status}
          statuses={statuses}
          orgSlug={orgSlug}
          slug={slug}
        />
      </ConfirmButton.Confirm>
    </ConfirmButton.Root>
  )
}

function ConfirmBody({ status, statuses, orgSlug, slug }: Props) {
  const { close, busy, setBusy } = useConfirmButton()
  const key = projectKey(orgSlug, slug)
  const remove = useAtomSet(deleteStatusAtom(key), { mode: "promiseExit" })

  const countResult = useAtomValue(
    ticketsCountAtom(ticketsCountKey(orgSlug, slug, {}))
  )
  const affectedCount = Result.isSuccess(countResult)
    ? (countResult.value.byStatus[status.slug] ?? 0)
    : 0

  const targets = statuses.filter((s) => s.slug !== status.slug)
  const [target, setTarget] = useState<string>("")
  const effectiveTarget = target || targets[0]?.slug || ""
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const exit = await remove({
      statusSlug: status.slug,
      reassignTo:
        affectedCount > 0 ? (effectiveTarget as StatusSlug) : undefined
    })
    if (Exit.isSuccess(exit)) {
      close()
      return
    }
    setBusy(false)
    setError(m.tickets_status_delete_error_fallback())
  }

  const blocked = busy || (affectedCount > 0 && !effectiveTarget)

  return (
    <>
      <span className="inline-flex h-8 items-center text-xs text-muted-foreground">
        {affectedCount > 0
          ? m.tickets_status_delete_confirm_with_tickets({
              count: affectedCount
            })
          : m.tickets_status_delete_confirm_empty()}
      </span>
      {affectedCount > 0 ? (
        <TargetPicker
          targets={targets}
          statuses={statuses}
          value={effectiveTarget}
          onChange={setTarget}
        />
      ) : null}
      <Button
        size="sm"
        onClick={() => {
          void run()
        }}
        disabled={blocked}
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        {busy ? m.tickets_status_deleting() : m.tickets_status_delete_button()}
      </Button>
      <ConfirmButton.Cancel />
      {error !== null ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </>
  )
}

function TargetPicker({
  targets,
  statuses,
  value,
  onChange
}: {
  targets: ReadonlyArray<ProjectStatus>
  statuses: ReadonlyArray<ProjectStatus>
  value: string
  onChange: (slug: string) => void
}) {
  const selectedMeta = statusMetaFor(value, statuses)
  const SelectedIcon = selectedMeta.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="tertiary" size="sm">
            <SelectedIcon
              className={cn("size-3.5", selectedMeta.className)}
              style={
                selectedMeta.color ? { color: selectedMeta.color } : undefined
              }
              strokeWidth={1.75}
            />
            <span>{statusLabelFor(value, statuses)}</span>
            <ChevronDown className="ml-1 size-3.5 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" sideOffset={6} className="w-44">
        {targets.map((s) => {
          const meta = statusMetaFor(s.slug, statuses)
          const Icon = meta.icon
          const selected = s.slug === value
          return (
            <DropdownMenuItem
              key={s.slug}
              onClick={() => onChange(s.slug)}
              className="cursor-pointer"
            >
              <Icon
                className={cn("size-4", meta.className)}
                style={meta.color ? { color: meta.color } : undefined}
                strokeWidth={1.75}
              />
              {meta.label}
              {selected ? (
                <Check className="ml-auto size-3.5 text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

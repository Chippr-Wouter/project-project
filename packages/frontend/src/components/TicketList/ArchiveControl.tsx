import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { Archive, ArchiveRestore } from "lucide-react"
import { useState } from "react"
import {
  archiveTicketAtom,
  ticketKey,
  unarchiveTicketAtom
} from "@/atoms/tickets"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { m } from "@/paraglide/messages"
import type { TicketId } from "@projectproject/shared"

export function ArchiveTicketControl({
  orgSlug,
  slug,
  id,
  archived
}: {
  orgSlug: string
  slug: string
  id: TicketId
  archived: boolean
}) {
  const tKey = ticketKey(orgSlug, slug, id)
  return archived ? (
    <UnarchiveButton tKey={tKey} />
  ) : (
    <ArchivePopover tKey={tKey} />
  )
}

function UnarchiveButton({ tKey }: { tKey: string }) {
  const unarchive = useAtomSet(unarchiveTicketAtom(tKey))
  const state = useAtomValue(unarchiveTicketAtom(tKey))
  const failed = Result.isFailure(state)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={m.tickets_unarchive_action_aria_label()}
      title={
        failed
          ? m.tickets_unarchive_error_fallback()
          : m.tickets_unarchive_button()
      }
      disabled={state.waiting}
      onClick={() => unarchive()}
      className={
        failed
          ? "text-destructive hover:text-destructive"
          : "text-muted-foreground hover:text-foreground"
      }
    >
      <ArchiveRestore strokeWidth={1.75} />
    </Button>
  )
}

function ArchivePopover({ tKey }: { tKey: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={m.tickets_archive_action_aria_label()}
            title={m.tickets_archive_action_aria_label()}
            className="text-muted-foreground hover:text-foreground"
          >
            <Archive strokeWidth={1.75} />
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <ArchiveForm
          tKey={tKey}
          reason={reason}
          onReasonChange={setReason}
          onClose={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}

function ArchiveForm({
  tKey,
  reason,
  onReasonChange,
  onClose
}: {
  tKey: string
  reason: string
  onReasonChange: (reason: string) => void
  onClose: () => void
}) {
  const archive = useAtomSet(archiveTicketAtom(tKey), { mode: "promiseExit" })
  const state = useAtomValue(archiveTicketAtom(tKey))
  const submitting = state.waiting
  const error = Result.isFailure(state)
    ? m.tickets_archive_error_fallback()
    : null

  const submit = () => {
    const trimmed = reason.trim()
    void archive({ reason: trimmed.length > 0 ? trimmed : undefined }).then(
      (exit) => {
        if (Exit.isSuccess(exit)) {
          onReasonChange("")
          onClose()
        }
      }
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{m.tickets_archive_confirm()}</p>
        <p className="text-xs text-muted-foreground">
          {m.tickets_archive_description()}
        </p>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          {m.tickets_archive_reason_label()}
        </span>
        <textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={m.tickets_archive_reason_placeholder()}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none ring-offset-background transition-colors focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onClose()}
        >
          {m.tickets_archive_cancel()}
        </Button>
        <Button type="button" size="sm" disabled={submitting} onClick={submit}>
          {m.tickets_archive_submit()}
        </Button>
      </div>
    </div>
  )
}

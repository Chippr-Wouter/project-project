import { Result, useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import * as Exit from "effect/Exit"
import { useEffect, useState, type KeyboardEvent } from "react"
import { ticketKey, updateTicketAtom } from "@/atoms/tickets"
import { m } from "@/paraglide/messages"
import type { TicketDetail } from "@projectproject/shared"

export function TitleField({
  orgSlug,
  slug,
  ticket
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
}) {
  const tKey = ticketKey(orgSlug, slug, ticket.id)
  const update = useAtomSet(updateTicketAtom(tKey), { mode: "promiseExit" })
  const updateState = useAtomValue(updateTicketAtom(tKey))
  const saving = updateState.waiting
  const failed = Result.isFailure(updateState)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ticket.title)

  useEffect(() => {
    if (!editing) setDraft(ticket.title)
  }, [editing, ticket.title])

  async function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === ticket.title) {
      setEditing(false)
      setDraft(ticket.title)
      return
    }
    const exit = await update({ title: trimmed })
    if (Exit.isFailure(exit)) return
    setEditing(false)
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      void commit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      setDraft(ticket.title)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-mx-2 block w-full rounded-md px-2 text-left text-2xl font-semibold tracking-tight transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className={saving || failed ? "animate-pulse" : undefined}>
          {ticket.title}
        </span>
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={draft}
      disabled={saving}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={handleKey}
      className="-mx-2 block w-full rounded-md bg-transparent px-2 text-2xl font-semibold tracking-tight outline-none ring-2 ring-ring/50"
      maxLength={200}
      aria-label={m.tickets_title_aria_label()}
    />
  )
}

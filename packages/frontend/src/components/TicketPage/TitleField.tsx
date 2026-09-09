import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { useCallback, useEffect, useState, type KeyboardEvent } from "react"
import { ticketKey, updateTicketAtom } from "@/atoms/tickets"
import { m } from "@/paraglide/messages"
import type { TicketDetail } from "@projectproject/shared"

const TITLE_TEXT = "text-xl font-semibold break-words whitespace-pre-wrap"
const TITLE_BOX = "-mx-2 w-full rounded-md px-2 text-left"

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

  const focusAtEnd = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

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

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
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
        className={`${TITLE_BOX} ${TITLE_TEXT} block transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50`}
      >
        <span className={saving || failed ? "animate-pulse" : undefined}>
          {ticket.title}
        </span>
      </button>
    )
  }
  return (
    <div
      className={`${TITLE_BOX} grid grid-cols-1 bg-accent/40 ring-2 ring-ring/50`}
    >
      <span aria-hidden className={`${TITLE_TEXT} invisible [grid-area:1/1]`}>
        {`${draft} `}
      </span>
      <textarea
        ref={focusAtEnd}
        rows={1}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={handleKey}
        className={`${TITLE_TEXT} min-w-0 resize-none overflow-hidden bg-transparent outline-none [grid-area:1/1]`}
        maxLength={200}
        aria-label={m.tickets_title_aria_label()}
      />
    </div>
  )
}

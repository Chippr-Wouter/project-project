import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { AutosizeTextarea } from "@/components/ui/autosize-textarea"
import { Editable } from "@/components/ui/editable"
import { ticketKey, updateTicketAtom } from "@/atoms/tickets"
import { errorMessage } from "@/lib/errorMessage"
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
  const atom = updateTicketAtom(ticketKey(orgSlug, slug, ticket.id))
  const update = useAtomSet(atom, { mode: "promiseExit" })
  const result = useAtomValue(atom)
  const error = Result.matchWithError(result, {
    onInitial: () => null,
    onSuccess: () => null,
    onError: (error) =>
      error._tag === "HttpClientError" ||
      error._tag === "SchemaError" ||
      error._tag === "Validation"
        ? m.tickets_title_save_error()
        : errorMessage(error),
    onDefect: () => m.tickets_title_save_error()
  })

  return (
    <Editable.Root
      key={ticket.id}
      value={ticket.title}
      pending={result.waiting}
      error={error}
      onCommit={async (value) => {
        const title = value.trim()
        if (!title || title === ticket.title) return true
        return Exit.isSuccess(await update({ title }))
      }}
    >
      <Editable.Preview className="block w-full rounded-md px-2 py-1.5 text-left text-xl font-semibold break-words whitespace-pre-wrap transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-pending:animate-pulse motion-reduce:animate-none" />
      <Editable.Input
        render={<AutosizeTextarea />}
        className="rounded-md bg-accent/40 px-2 py-1.5 text-xl font-semibold outline-none ring-2 ring-ring/50 data-pending:animate-pulse motion-reduce:animate-none"
        maxLength={200}
        aria-label={m.tickets_title_aria_label()}
      />
      <Editable.Error className="mt-1 block text-xs font-normal text-destructive" />
    </Editable.Root>
  )
}

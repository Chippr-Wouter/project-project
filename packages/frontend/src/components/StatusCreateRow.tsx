import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { Plus } from "lucide-react"
import { useState } from "react"
import type { ProjectStatus } from "@projectproject/shared"
import { createStatusAtom, projectKey } from "@/atoms/projectStatuses"
import { statusCreateErrorMessage } from "@/lib/errorMessage"
import { Button } from "@/components/ui/button"
import { InlineForm, useInlineForm } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { m } from "@/paraglide/messages"

type Props = {
  orgSlug: string
  slug: string
}

export function StatusCreateRow({ orgSlug, slug }: Props) {
  const Root = InlineForm.Root<"create">
  return (
    <Root variant="ghost" className="self-start">
      <InlineForm.Idle>
        <InlineForm.Trigger
          action="create"
          variant="tertiary"
          size="sm"
          leadingIcon={Plus}
        >
          {m.tickets_status_create_add()}
        </InlineForm.Trigger>
      </InlineForm.Idle>
      <InlineForm.Form action="create" className="space-y-0">
        <CreateFields orgSlug={orgSlug} slug={slug} />
      </InlineForm.Form>
    </Root>
  )
}

function CreateFields({ orgSlug, slug }: Props) {
  const key = projectKey(orgSlug, slug)
  const create = useAtomSet(createStatusAtom(key), { mode: "promiseExit" })
  const createState = useAtomValue(createStatusAtom(key))
  const { close, busy, setBusy } = useInlineForm<"create">()
  const [draft, setDraft] = useState("")
  const [didSubmit, setDidSubmit] = useState(false)

  const error =
    didSubmit && !createState.waiting
      ? Result.matchWithError(createState, {
          onInitial: () => null,
          onSuccess: () => null,
          onError: (e) => statusCreateErrorMessage(e),
          onDefect: () => m.tickets_status_create_error_fallback()
        })
      : null

  const submit = async () => {
    const trimmed = draft.trim()
    if (trimmed.length === 0) {
      setDraft("")
      close()
      return
    }
    setBusy(true)
    setDidSubmit(true)
    const exit = await create({ label: trimmed as ProjectStatus["label"] })
    if (Exit.isSuccess(exit)) {
      setDraft("")
      close()
    } else {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      className="space-y-1 px-1 py-1"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-5 shrink-0 items-center justify-center text-muted-foreground/40">
          <Plus className="h-4 w-4" />
        </span>
        <Input
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              setDraft("")
              close()
            }
          }}
          placeholder={m.tickets_status_create_placeholder()}
          className="h-8 flex-1 rounded-md"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setDraft("")
            close()
          }}
        >
          {m.tickets_status_delete_cancel()}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant="primary"
          disabled={busy || !draft.trim()}
        >
          {m.tickets_status_create_add()}
        </Button>
      </div>
      {error ? (
        <p className="pl-7 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}

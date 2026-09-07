import { useAtomSet } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { clearBranchAtom } from "@/atoms/github"
import { projectKey } from "@/atoms/projects"
import { Button } from "@/components/ui/button"
import { InlineForm, useInlineForm } from "@/components/ui/inline-form"
import { m } from "@/paraglide/messages"
import type { TicketId } from "@projectproject/shared"

export function ClearBranchFields({
  orgSlug,
  slug,
  id,
  variant = "bordered"
}: {
  orgSlug: string
  slug: string
  id: TicketId
  variant?: "bordered" | "ghost"
}) {
  const { busy, setBusy, close } = useInlineForm()
  const buttonSize = variant === "bordered" ? "sm" : "xs"
  const clear = useAtomSet(clearBranchAtom(projectKey(orgSlug, slug)), {
    mode: "promiseExit"
  })

  async function submit() {
    setBusy(true)
    const exit = await clear({ id })
    if (Exit.isSuccess(exit)) {
      close()
    } else {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-2 text-xs @max-sm/git-panel:flex-col @max-sm/git-panel:items-stretch">
      <span className="mr-auto text-muted-foreground @max-sm/git-panel:mr-0">
        {m.git_clear_branch_prompt()}
      </span>
      <div className="flex gap-2 @max-sm/git-panel:justify-end">
        <InlineForm.Cancel size={buttonSize} />
        <Button
          size={buttonSize}
          variant="ghost"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy
            ? m.git_clear_branch_in_progress()
            : m.git_clear_branch_button()}
        </Button>
      </div>
    </div>
  )
}

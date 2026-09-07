import { useAtomSet } from "@effect/atom-react"
import { useState } from "react"
import { LexicalEditor, type SaveStatus } from "@/components/LexicalEditor"
import { Markdown } from "@/components/Markdown"
import { MarkdownSaveIndicator } from "@/components/MarkdownSaveIndicator"
import { MentionScopeProvider } from "@/mentions/scope"
import { m } from "@/paraglide/messages"
import { projectKey, updateSprintAtom } from "@/atoms/sprints"
import type { GroupDetail } from "@projectproject/shared"
import { useProject } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/-context"

export function SprintDescription({
  orgSlug,
  slug,
  sprint,
  disabled
}: {
  orgSlug: string
  slug: string
  sprint: GroupDetail
  disabled: boolean
}) {
  const project = useProject()
  const key = projectKey(orgSlug, slug)
  const update = useAtomSet(updateSprintAtom(key))
  const [status, setStatus] = useState<SaveStatus>("idle")

  if (disabled) {
    if (sprint.body.trim().length === 0) return null
    return (
      <Markdown className="rounded-lg border border-border bg-background px-3 py-2">
        {sprint.body}
      </Markdown>
    )
  }

  return (
    <div className="grid gap-2">
      <MentionScopeProvider scope={{ orgSlug, slug, members: project.members }}>
        <LexicalEditor
          key={`sprint:${sprint.id}`}
          markdown={sprint.body}
          onChange={(next) => {
            update({ groupId: sprint.id, patch: { body: next } })
          }}
          onStatusChange={setStatus}
          placeholder={m.sprints_description_placeholder()}
          className="rounded-lg border border-border bg-background px-3 py-2"
        />
      </MentionScopeProvider>
      <MarkdownSaveIndicator
        status={status}
        className="justify-self-end tabular-nums"
      />
    </div>
  )
}

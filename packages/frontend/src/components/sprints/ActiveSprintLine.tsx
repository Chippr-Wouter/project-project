import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { Link } from "@tanstack/react-router"
import { m } from "@/paraglide/messages"
import { projectKey, sprintsListAtom } from "@/atoms/sprints"
import { daysLeft, pickActiveSprint } from "@projectproject/shared"
import { SprintStateIcon } from "./SprintChip"

export function ActiveSprintLine({
  orgSlug,
  slug
}: {
  orgSlug: string
  slug: string
}) {
  const list = useAtomValue(sprintsListAtom(projectKey(orgSlug, slug)))
  const sprints = Result.isSuccess(list) ? list.value : []
  const active = pickActiveSprint(sprints)

  if (!active) {
    return <p className="font-mono text-xs text-muted-foreground">/{slug}</p>
  }
  const left = daysLeft(active.endsAt)
  const summary =
    left === null
      ? active.name
      : left >= 0
        ? m.project_header_active_sprint_summary({
            name: active.name,
            days: left
          })
        : m.project_header_active_sprint_overdue({
            name: active.name,
            days: -left
          })

  return (
    <Link
      to="/orgs/$orgSlug/projects/$slug/sprints/$groupId"
      params={{ orgSlug, slug, groupId: active.id }}
      className="-mx-1 inline-flex w-fit items-center gap-1.5 rounded px-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
    >
      <SprintStateIcon sprint={active} size="xs" />
      <span className="font-mono">{summary}</span>
    </Link>
  )
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { meAtom } from "@/atoms/auth"
import { projectKey, updateProjectSetupAtom } from "@/atoms/projects"
import { MembersSection } from "@/components/MembersSection"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages"
import { useProject } from "../-context"
import type { Member, Role } from "@projectproject/shared"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/settings/team"
)({
  component: TeamSettings,
  loader: () => ({
    crumb: { type: "static" as const, label: m.project_settings_team_tab() }
  })
})

function TeamSettings() {
  const { orgSlug } = Route.useParams()
  const project = useProject()
  const me = useAtomValue(meAtom)
  const setup = useAtomSet(
    updateProjectSetupAtom(projectKey(orgSlug, project.slug))
  )
  if (!Result.isSuccess(me)) return null
  const callerId = me.value.id
  const callerRole = roleOf(project.members, callerId)
  if (!callerRole) return null

  return (
    <section className="flex w-full flex-col gap-4">
      <MembersSection
        orgSlug={orgSlug}
        slug={project.slug}
        members={project.members}
        pendingMembers={project.pendingMembers}
        callerRole={callerRole}
        callerId={callerId}
      />
      {project.setup.invitePeopleDismissedAt ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {m.project_setup_invite_dismissed_note()}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setup({ invitePeopleDismissedAt: null })}
          >
            {m.project_setup_restore_button()}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function roleOf(members: ReadonlyArray<Member>, userId: string): Role | null {
  for (const member of members) if (member.id === userId) return member.role
  return null
}

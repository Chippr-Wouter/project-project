import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { meAtom } from "@/atoms/auth"
import { orgDetailAtom, orgMembersAtom } from "@/atoms/orgs"
import { ErrorPage } from "@/components/ErrorPage"
import { OrgMembersSection } from "@/components/OrgMembersSection"
import { m } from "@/paraglide/messages"

import type { OrgDetail } from "@projectproject/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/settings/members")(
  {
    component: MembersSettings,
    loader: () => ({
      crumb: { type: "static" as const, label: m.org_settings_members_tab() }
    })
  }
)

function MembersSettings() {
  const { orgSlug } = Route.useParams()
  const detail = useAtomValue(orgDetailAtom(orgSlug))

  return Result.matchWithError(detail, {
    onInitial: () => <MembersSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value }) => <MembersBody orgSlug={orgSlug} org={value} />
  })
}

function MembersBody({ orgSlug, org }: { orgSlug: string; org: OrgDetail }) {
  const membersResult = useAtomValue(orgMembersAtom(orgSlug))
  const me = useAtomValue(meAtom)

  return Result.matchWithError(me, {
    onInitial: () => <MembersSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value: currentUser }) =>
      Result.matchWithError(membersResult, {
        onInitial: () => <MembersSkeleton />,
        onError: (error) => <ErrorPage error={error} contained />,
        onDefect: (defect) => <ErrorPage error={defect} contained />,
        onSuccess: ({ value }) => (
          <section className="flex w-full flex-col gap-4">
            <OrgMembersSection
              orgSlug={orgSlug}
              orgName={org.name}
              members={value.members}
              invitations={value.invitations}
              callerRole={org.role}
              callerUserId={currentUser.id}
            />
          </section>
        )
      })
  })
}

function MembersSkeleton() {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
      <div className="divide-y divide-border rounded-xl border border-border bg-background">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-3 px-3 py-2.5">
            <div className="size-8 animate-pulse rounded-full bg-muted" />
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
              <div className="h-3 w-48 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}

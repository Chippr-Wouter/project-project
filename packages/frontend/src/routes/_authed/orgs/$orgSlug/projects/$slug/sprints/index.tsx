import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { Navigate, createFileRoute } from "@tanstack/react-router"
import { SprintDetailSkeleton } from "@/components/sprints/SprintDetailSkeleton"
import { SprintsEmpty } from "@/components/sprints/SprintsEmpty"
import { PageContainer } from "@/components/page"
import { projectKey, sprintsListAtom } from "@/atoms/sprints"
import {
  pickActiveSprint,
  pickEarliestPlannedSprint,
  type Group
} from "@projectproject/shared"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/sprints/"
)({
  component: SprintsIndex
})

function pickRedirectTarget(sprints: ReadonlyArray<Group>): Group | null {
  const active = pickActiveSprint(sprints)
  if (active) return active
  const planned = pickEarliestPlannedSprint(sprints)
  if (planned) return planned
  const completed = sprints
    .filter((s) => s.completedAt !== null)
    .sort(
      (a, b) =>
        (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
    )
  return completed[0] ?? null
}

function SprintsIndex() {
  const { orgSlug, slug } = Route.useParams()
  const list = useAtomValue(sprintsListAtom(projectKey(orgSlug, slug)))

  if (Result.isInitial(list)) {
    return (
      <PageContainer>
        <SprintDetailSkeleton />
      </PageContainer>
    )
  }
  const sprints = Result.isSuccess(list) ? list.value : []
  const target = pickRedirectTarget(sprints)
  if (target) {
    return (
      <Navigate
        to="/orgs/$orgSlug/projects/$slug/sprints/$groupId"
        params={{ orgSlug, slug, groupId: target.id }}
        replace
      />
    )
  }
  return (
    <PageContainer>
      <SprintsEmpty />
    </PageContainer>
  )
}

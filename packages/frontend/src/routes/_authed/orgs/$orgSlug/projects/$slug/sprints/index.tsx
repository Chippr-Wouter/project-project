import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Navigate, createFileRoute } from "@tanstack/react-router"
import { SprintDetailSkeleton } from "@/components/sprints/SprintDetailSkeleton"
import { SprintsEmpty } from "@/components/sprints/SprintsEmpty"
import { PageContainer } from "@/components/page"
import { ErrorPage } from "@/components/ErrorPage"
import {
  projectKey,
  sprintsListAtom,
  sprintsListBaseAtom
} from "@/atoms/sprints"
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

  const refresh = useAtomRefresh(sprintsListBaseAtom(projectKey(orgSlug, slug)))

  return Result.matchWithError(list, {
    onInitial: () => (
      <PageContainer>
        <SprintDetailSkeleton />
      </PageContainer>
    ),
    onError: (error) => <ErrorPage error={error} reset={refresh} contained />,
    onDefect: (defect) => (
      <ErrorPage error={defect} reset={refresh} contained />
    ),
    onSuccess: ({ value }) => {
      const target = pickRedirectTarget(value)
      return target ? (
        <Navigate
          to="/orgs/$orgSlug/projects/$slug/sprints/$groupId"
          params={{ orgSlug, slug, groupId: target.id }}
          replace
        />
      ) : (
        <PageContainer>
          <SprintsEmpty />
        </PageContainer>
      )
    }
  })
}

import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import { projectStatusesAtom } from "@/atoms/projectStatuses"
import { ticketsInSprintAtom, ticketsInSprintKey } from "@/atoms/tickets"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { Navigate, createFileRoute, redirect } from "@tanstack/react-router"
import { SprintDetailSkeleton } from "@/components/sprints/SprintDetailSkeleton"
import { SprintsEmpty } from "@/components/sprints/SprintsEmpty"
import { PageContainer } from "@/components/page"
import { ErrorPage } from "@/components/ErrorPage"
import {
  projectKey,
  sprintAtom,
  sprintKey,
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
  component: SprintsIndex,
  loader: async ({
    context: { registry },
    params: { orgSlug, slug },
    abortController
  }) => {
    const key = projectKey(orgSlug, slug)
    const result = await Effect.runPromiseExit(
      Registry.getResult(registry, sprintsListAtom(key)),
      { signal: abortController.signal }
    )
    if (Exit.isFailure(result)) return
    const target = pickRedirectTarget(result.value)
    if (!target) return
    registry.mount(sprintAtom(sprintKey(orgSlug, slug, target.id)))()
    registry.mount(projectStatusesAtom(key))()
    registry.mount(
      ticketsInSprintAtom(ticketsInSprintKey(orgSlug, slug, target.id))
    )()
    throw redirect({
      to: "/orgs/$orgSlug/projects/$slug/sprints/$groupId",
      params: { orgSlug, slug, groupId: target.id },
      search: { view: "board" },
      replace: true
    })
  }
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

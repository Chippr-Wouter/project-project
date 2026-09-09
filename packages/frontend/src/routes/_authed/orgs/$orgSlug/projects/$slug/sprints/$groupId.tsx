import { useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import * as Schema from "effect/Schema"
import * as Effect from "effect/Effect"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import { projectStatusesAtom } from "@/atoms/projectStatuses"
import {
  projectKey,
  sprintAtom,
  sprintKey,
  sprintsListAtom
} from "@/atoms/sprints"
import {
  ticketsCountAtom,
  ticketsCountKey,
  ticketsInSprintAtom,
  ticketsInSprintKey,
  ticketsListAtom,
  ticketsListKeyForStatus
} from "@/atoms/tickets"
import { SprintDetail } from "@/components/sprints/SprintDetail"
import {
  GroupId,
  ticketListQueryFromSearch,
  ticketListQueryToSearch,
  type TicketListQuery
} from "@projectproject/shared"

const decodeGroupId = Schema.decodeUnknownSync(GroupId)

type SprintRouteSearch = ReturnType<typeof ticketListQueryToSearch> & {
  view?: "list" | "board" | "description"
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/sprints/$groupId"
)({
  component: SprintDetailRoute,
  validateSearch: (search: Record<string, unknown>): SprintRouteSearch => {
    const { groupId: _groupId, ...sanitized } = ticketListQueryToSearch(
      ticketListQueryFromSearch(search)
    )
    const view =
      search.view === "list"
        ? "list"
        : search.view === "description"
          ? "description"
          : "board"
    return { ...sanitized, view }
  },
  loaderDeps: ({ search }) => search,
  loader: async ({
    context: { registry },
    params: { orgSlug, slug, groupId },
    deps: search,
    abortController
  }) => {
    const id = decodeGroupId(groupId)
    const key = projectKey(orgSlug, slug)
    const query = sprintListQuery(search, id)
    const view = search.view ?? "board"
    const tickets =
      view === "list"
        ? Effect.all(
            [
              Registry.getResult(
                registry,
                ticketsCountAtom(
                  ticketsCountKey(orgSlug, slug, {
                    filter: query.filter,
                    q: query.q
                  })
                )
              ),
              Effect.gen(function* () {
                const statuses = yield* Registry.getResult(
                  registry,
                  projectStatusesAtom(key)
                )
                yield* Effect.forEach(
                  statuses.filter(
                    (status) =>
                      !query.filter?.status?.length ||
                      query.filter.status.includes(status.slug)
                  ),
                  (status) =>
                    Effect.exit(
                      // @effect-diagnostics-next-line anyUnknownInErrorContext:off
                      Registry.getResult(
                        registry,
                        ticketsListAtom(
                          ticketsListKeyForStatus(
                            orgSlug,
                            slug,
                            query,
                            status.slug
                          )
                        )
                      )
                    ),
                  { concurrency: 4, discard: true }
                )
              })
            ],
            { concurrency: "unbounded", discard: true }
          )
        : view === "board"
          ? Registry.getResult(
              registry,
              ticketsInSprintAtom(ticketsInSprintKey(orgSlug, slug, id))
            )
          : Effect.void

    await Effect.runPromiseExit(
      Effect.all(
        [
          Registry.getResult(
            registry,
            sprintAtom(sprintKey(orgSlug, slug, id))
          ),
          Registry.getResult(registry, sprintsListAtom(key)),
          Registry.getResult(registry, projectStatusesAtom(key)),
          tickets
        ],
        { concurrency: "unbounded", discard: true }
      ),
      { signal: abortController.signal }
    )

    return {
      crumb: { type: "sprint" as const, orgSlug, slug, groupId: id }
    }
  }
})

function SprintDetailRoute() {
  const { orgSlug, slug, groupId } = Route.useParams()
  const search = Route.useSearch({ structuralSharing: true })
  const id = decodeGroupId(groupId)
  const scopedQuery = useMemo(() => sprintListQuery(search, id), [search, id])
  return (
    <SprintDetail
      orgSlug={orgSlug}
      slug={slug}
      groupId={id}
      view={search.view ?? "board"}
      listQuery={scopedQuery}
    />
  )
}

function sprintListQuery(
  search: SprintRouteSearch,
  id: GroupId
): TicketListQuery {
  const query = ticketListQueryFromSearch(search)
  return { ...query, filter: { ...query.filter, groupId: [id] } }
}

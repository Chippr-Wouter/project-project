import { createFileRoute } from "@tanstack/react-router"
import * as Schema from "effect/Schema"
import { projectStatusesAtom } from "@/atoms/projectStatuses"
import {
  projectKey,
  sprintAtom,
  sprintKey,
  sprintsListAtom
} from "@/atoms/sprints"
import {
  ticketsSectionsAtom,
  ticketsSectionsKey,
  ticketsInSprintAtom,
  ticketsInSprintKey
} from "@/atoms/tickets"
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
  component: () => null,
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
  loader: ({
    context: { registry },
    params: { orgSlug, slug, groupId },
    deps: search
  }) => {
    const id = decodeGroupId(groupId)
    const key = projectKey(orgSlug, slug)
    const query = sprintListQuery(search, id)
    const view = search.view ?? "board"
    registry.mount(sprintAtom(sprintKey(orgSlug, slug, id)))()
    registry.mount(sprintsListAtom(key))()
    registry.mount(projectStatusesAtom(key))()
    if (view === "list") {
      registry.mount(
        ticketsSectionsAtom(ticketsSectionsKey(orgSlug, slug, query))
      )()
    } else if (view === "board") {
      registry.mount(
        ticketsInSprintAtom(ticketsInSprintKey(orgSlug, slug, id))
      )()
    }

    return {
      crumb: { type: "sprint" as const, orgSlug, slug, groupId: id }
    }
  }
})

function sprintListQuery(
  search: SprintRouteSearch,
  id: GroupId
): TicketListQuery {
  const query = ticketListQueryFromSearch(search)
  return { ...query, filter: { ...query.filter, groupId: [id] } }
}

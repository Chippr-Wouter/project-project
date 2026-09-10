import { projectAtom } from "@/atoms/projects"
import { projectStatusesAtom } from "@/atoms/projectStatuses"
import { sprintsListAtom, projectKey } from "@/atoms/sprints"
import { ticketsSectionsAtom, ticketsSectionsKey } from "@/atoms/tickets"
import { createFileRoute } from "@tanstack/react-router"
import {
  ticketListQueryFromSearch,
  ticketListQueryToSearch
} from "@projectproject/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/projects/$slug/")({
  component: () => null,
  loaderDeps: ({ search }) => ticketListQueryFromSearch(search),
  loader: ({
    context: { registry },
    params: { orgSlug, slug },
    deps: query
  }) => {
    const key = projectKey(orgSlug, slug)
    registry.mount(projectAtom(key))()
    registry.mount(sprintsListAtom(key))()
    registry.mount(projectStatusesAtom(key))()
    registry.mount(
      ticketsSectionsAtom(ticketsSectionsKey(orgSlug, slug, query))
    )()
  },
  validateSearch: (search: Record<string, unknown>) =>
    ticketListQueryToSearch(ticketListQueryFromSearch(search))
})

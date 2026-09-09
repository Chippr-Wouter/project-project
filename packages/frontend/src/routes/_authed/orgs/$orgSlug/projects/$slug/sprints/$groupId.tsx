import { useMemo } from "react"
import { createFileRoute } from "@tanstack/react-router"
import * as Schema from "effect/Schema"
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
  loader: ({ params }) => ({
    crumb: {
      type: "sprint" as const,
      orgSlug: params.orgSlug,
      slug: params.slug,
      groupId: decodeGroupId(params.groupId)
    }
  })
})

function SprintDetailRoute() {
  const { orgSlug, slug, groupId } = Route.useParams()
  const search = Route.useSearch({ structuralSharing: true })
  const id = decodeGroupId(groupId)
  const scopedQuery = useMemo<TicketListQuery>(() => {
    const query = ticketListQueryFromSearch(search)
    return {
      ...query,
      filter: { ...query.filter, groupId: [id] }
    }
  }, [search, id])
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

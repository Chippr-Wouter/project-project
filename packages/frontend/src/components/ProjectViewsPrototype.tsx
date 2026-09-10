import { Activity, useMemo, useState } from "react"
import { useMatches } from "@tanstack/react-router"
import * as Schema from "effect/Schema"
import { GroupId, ticketListQueryFromSearch } from "@projectproject/shared"
import { BacklogView } from "./TicketList/BacklogView"
import { useUpdateTicketQuery } from "./TicketList/url"
import { SprintDetail } from "./sprints/SprintDetail"

const decodeGroupId = Schema.decodeUnknownSync(GroupId)

export function ProjectViewsPrototype({
  orgSlug,
  slug
}: {
  orgSlug: string
  slug: string
}) {
  const backlog = useMatches({
    select: (matches) =>
      matches.find(
        (match) => match.routeId === "/_authed/orgs/$orgSlug/projects/$slug/"
      )
  })
  const sprint = useMatches({
    select: (matches) =>
      matches.find(
        (match) =>
          match.routeId ===
          "/_authed/orgs/$orgSlug/projects/$slug/sprints/$groupId"
      )
  })
  const [lastBacklog, setLastBacklog] = useState(backlog?.search)
  const [lastSprint, setLastSprint] = useState(
    sprint && {
      groupId: sprint.params.groupId,
      search: sprint.search
    }
  )
  if (backlog && lastBacklog !== backlog.search) setLastBacklog(backlog.search)
  if (
    sprint &&
    (lastSprint?.groupId !== sprint.params.groupId ||
      lastSprint.search !== sprint.search)
  ) {
    setLastSprint({ groupId: sprint.params.groupId, search: sprint.search })
  }
  const updateQuery = useUpdateTicketQuery()
  const backlogQuery = useMemo(
    () => ticketListQueryFromSearch(lastBacklog ?? {}),
    [lastBacklog]
  )
  const sprintId = lastSprint ? decodeGroupId(lastSprint.groupId) : null
  const sprintQuery = useMemo(() => {
    const query = ticketListQueryFromSearch(lastSprint?.search ?? {})
    return sprintId
      ? { ...query, filter: { ...query.filter, groupId: [sprintId] } }
      : query
  }, [lastSprint?.search, sprintId])

  return (
    <>
      <Activity mode={backlog ? "visible" : "hidden"}>
        {lastBacklog && (
          <BacklogView
            orgSlug={orgSlug}
            slug={slug}
            query={backlogQuery}
            onQueryChange={updateQuery}
          />
        )}
      </Activity>
      <Activity mode={sprint ? "visible" : "hidden"}>
        {lastSprint && sprintId && (
          <SprintDetail
            key={sprintId}
            orgSlug={orgSlug}
            slug={slug}
            groupId={sprintId}
            view={lastSprint.search.view ?? "board"}
            listQuery={sprintQuery}
            onQueryChange={updateQuery}
          />
        )}
      </Activity>
    </>
  )
}

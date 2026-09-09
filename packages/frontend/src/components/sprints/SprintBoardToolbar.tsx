import { TicketToolbar } from "@/components/TicketList/toolbar"
import type {
  GroupId,
  Member,
  TicketId,
  TicketListQuery
} from "@projectproject/shared"
import { useBoardTickets } from "./useBoardTickets"

export function SprintBoardToolbar({
  orgSlug,
  slug,
  groupId,
  ticketIds,
  query,
  onQueryChange,
  members
}: {
  orgSlug: string
  slug: string
  groupId: GroupId
  ticketIds: ReadonlyArray<TicketId>
  query: TicketListQuery
  onQueryChange: (query: TicketListQuery) => void
  members: ReadonlyArray<Member>
}) {
  const { counts } = useBoardTickets(orgSlug, slug, groupId, ticketIds, query)
  return (
    <TicketToolbar
      orgSlug={orgSlug}
      slug={slug}
      query={query}
      onQueryChange={onQueryChange}
      members={members}
      counts={counts}
      filters={["type", "assignee", "tags"]}
    />
  )
}

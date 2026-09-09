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
  members
}: {
  orgSlug: string
  slug: string
  groupId: GroupId
  ticketIds: ReadonlyArray<TicketId>
  query: TicketListQuery
  members: ReadonlyArray<Member>
}) {
  const { counts } = useBoardTickets(orgSlug, slug, groupId, ticketIds, query)
  return (
    <TicketToolbar.Provider
      orgSlug={orgSlug}
      slug={slug}
      query={query}
      members={members}
      counts={counts}
      filters={["type", "assignee", "tags"]}
    >
      <TicketToolbar.Root>
        <TicketToolbar.Search />
        <TicketToolbar.Controls>
          <TicketToolbar.Status />
          <TicketToolbar.Filters />
          <TicketToolbar.ClearAll />
        </TicketToolbar.Controls>
      </TicketToolbar.Root>
    </TicketToolbar.Provider>
  )
}

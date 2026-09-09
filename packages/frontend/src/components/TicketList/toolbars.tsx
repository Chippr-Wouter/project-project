import type { Member, TicketListQuery } from "@projectproject/shared"
import { TicketToolbar, useServerTicketCounts } from "./toolbar"

type ToolbarVariantProps = {
  orgSlug: string
  slug: string
  query: TicketListQuery
  members: ReadonlyArray<Member>
}

export function BacklogToolbar({
  orgSlug,
  slug,
  query,
  members
}: ToolbarVariantProps) {
  const counts = useServerTicketCounts(orgSlug, slug, query)
  return (
    <TicketToolbar.Provider
      orgSlug={orgSlug}
      slug={slug}
      query={query}
      members={members}
      counts={counts}
      filters={["archived", "type", "assignee", "sprint", "tags"]}
    >
      <TicketToolbar.Root>
        <TicketToolbar.Search />
        <TicketToolbar.Controls>
          <TicketToolbar.Status />
          <TicketToolbar.Filters />
          <TicketToolbar.Sort />
          <TicketToolbar.ClearAll />
        </TicketToolbar.Controls>
      </TicketToolbar.Root>
    </TicketToolbar.Provider>
  )
}

export function SprintListToolbar({
  orgSlug,
  slug,
  query,
  members
}: ToolbarVariantProps) {
  const counts = useServerTicketCounts(orgSlug, slug, query)
  return (
    <TicketToolbar.Provider
      orgSlug={orgSlug}
      slug={slug}
      query={query}
      members={members}
      counts={counts}
      filters={["archived", "type", "assignee", "tags"]}
    >
      <TicketToolbar.Root>
        <TicketToolbar.Search />
        <TicketToolbar.Controls>
          <TicketToolbar.Status />
          <TicketToolbar.Filters />
          <TicketToolbar.Sort />
          <TicketToolbar.ClearAll />
        </TicketToolbar.Controls>
      </TicketToolbar.Root>
    </TicketToolbar.Provider>
  )
}

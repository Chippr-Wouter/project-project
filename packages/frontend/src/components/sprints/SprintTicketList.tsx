import type { ReactNode } from "react"
import { TicketList } from "@/components/TicketList"
import { SprintListToolbar } from "@/components/TicketList/toolbars"
import type { Member, TicketListQuery } from "@projectproject/shared"

export function SprintTicketList({
  orgSlug,
  slug,
  query,
  members,
  creator
}: {
  orgSlug: string
  slug: string
  query: TicketListQuery
  members: ReadonlyArray<Member>
  creator: ReactNode
}) {
  return (
    <TicketList
      orgSlug={orgSlug}
      slug={slug}
      query={query}
      members={members}
      creator={creator}
      toolbar={
        <SprintListToolbar
          orgSlug={orgSlug}
          slug={slug}
          query={query}
          members={members}
        />
      }
    />
  )
}

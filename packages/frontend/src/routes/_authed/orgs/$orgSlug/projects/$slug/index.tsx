import { createFileRoute } from "@tanstack/react-router"
import { useAtomValue } from "@effect/atom-react"
import {
  ticketListQueryFromSearch,
  ticketListQueryToSearch
} from "@projectproject/shared"
import { TicketList } from "@/components/TicketList"
import { ArchiveTicketControl } from "@/components/TicketList/ArchiveControl"
import { PageContainer } from "@/components/page"
import { projectKey, sprintMembershipAtom } from "@/atoms/sprints"
import { useProject } from "./-context"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/projects/$slug/")({
  component: TicketsTab,
  validateSearch: (search: Record<string, unknown>) =>
    ticketListQueryToSearch(ticketListQueryFromSearch(search))
})

function TicketsTab() {
  const { orgSlug, slug } = Route.useParams()
  const search = Route.useSearch()
  const project = useProject()
  const query = ticketListQueryFromSearch(search)
  const sprintMembership = useAtomValue(
    sprintMembershipAtom(projectKey(orgSlug, slug))
  )
  return (
    <PageContainer>
      <TicketList
        orgSlug={orgSlug}
        slug={slug}
        query={query}
        members={project.members}
        sprintMembership={sprintMembership}
        showSprintFilter
        extraRowActions={(ticket) => (
          <ArchiveTicketControl
            orgSlug={orgSlug}
            slug={slug}
            id={ticket.id}
            archived={ticket.archivedAt !== null}
          />
        )}
      />
    </PageContainer>
  )
}

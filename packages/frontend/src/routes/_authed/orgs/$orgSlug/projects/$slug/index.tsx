import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Effect from "effect/Effect"
import { projectAtom } from "@/atoms/projects"
import { projectStatusesAtom } from "@/atoms/projectStatuses"
import { sprintsListAtom } from "@/atoms/sprints"
import {
  ticketsCountAtom,
  ticketsCountKey,
  ticketsListAtom,
  ticketsListKeyForStatus
} from "@/atoms/tickets"
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
  loaderDeps: ({ search }) => ticketListQueryFromSearch(search),
  loader: async ({
    context: { registry },
    params: { orgSlug, slug },
    deps: query,
    abortController
  }) => {
    const key = projectKey(orgSlug, slug)
    await Effect.runPromiseExit(
      Effect.all(
        [
          Registry.getResult(registry, projectAtom(key)),
          Registry.getResult(registry, sprintsListAtom(key)),
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
                      ticketsListKeyForStatus(orgSlug, slug, query, status.slug)
                    )
                  )
                ),
              { concurrency: "unbounded" }
            )
          })
        ],
        { concurrency: "unbounded", discard: true }
      ),
      { signal: abortController.signal }
    )
  },
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

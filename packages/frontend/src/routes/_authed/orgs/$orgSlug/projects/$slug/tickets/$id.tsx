import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import * as Schema from "effect/Schema"
import { useEffect, useRef } from "react"
import { TicketPage, TicketPageSkeleton } from "@/components/TicketPage"
import { ErrorPage } from "@/components/ErrorPage"
import { NotFoundPage } from "@/components/NotFoundPage"
import { TicketId } from "@projectproject/shared"
import { commentsAtom, commentsKey } from "@/atoms/comments"
import { orgDetailAtom } from "@/atoms/orgs"
import { orgStorageAtom } from "@/atoms/storage"
import { ticketAtom, ticketKey } from "@/atoms/tickets"
import { m } from "@/paraglide/messages"
import { useProject } from "../-context"

const decodeTicketId = Schema.decodeUnknownSync(TicketId)

interface TicketDetailSearch {
  focusBody?: 1
}

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/tickets/$id"
)({
  component: TicketDetailRoute,
  validateSearch: (search: Record<string, unknown>): TicketDetailSearch => {
    if (search.focusBody === 1) return { focusBody: 1 }
    return {}
  },
  loader: ({ context, params }) => {
    const id = decodeTicketId(params.id)
    context.registry.mount(
      ticketAtom(ticketKey(params.orgSlug, params.slug, id))
    )()
    context.registry.mount(
      commentsAtom(commentsKey(params.orgSlug, params.slug, id))
    )()
    context.registry.mount(orgStorageAtom(params.orgSlug))()
    context.registry.mount(orgDetailAtom(params.orgSlug))()
    return {
      crumb: {
        type: "ticket" as const,
        orgSlug: params.orgSlug,
        slug: params.slug,
        id
      }
    }
  }
})

function TicketDetailRoute() {
  const { orgSlug, slug, id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const ticketId = decodeTicketId(id)
  const result = useAtomValue(ticketAtom(ticketKey(orgSlug, slug, ticketId)))
  const project = useProject()
  const autoFocusBody = useRef(search.focusBody === 1).current

  useEffect(() => {
    if (!autoFocusBody) return
    void navigate({
      to: ".",
      search: () => ({}),
      replace: true
    })
  }, [autoFocusBody, navigate])

  return Result.matchWithError(result, {
    onInitial: () => <TicketPageSkeleton />,
    onError: (error) =>
      error._tag === "NotFound" ? (
        <NotFoundPage
          contained
          title={m.tickets_not_found_title()}
          body={m.tickets_not_found_body()}
        />
      ) : (
        <ErrorPage contained error={error} />
      ),
    onDefect: (defect) => <ErrorPage contained error={defect} />,
    onSuccess: ({ value }) => (
      <TicketPage
        orgSlug={orgSlug}
        slug={slug}
        ticket={value}
        members={project.members}
        github={project.github}
        autoFocusBody={autoFocusBody}
      />
    )
  })
}

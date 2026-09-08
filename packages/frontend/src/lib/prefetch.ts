import * as Result from "effect/unstable/reactivity/AsyncResult"
import { ticketListQueryFromSearch } from "@projectproject/shared"
import * as Atom from "effect/unstable/reactivity/Atom"
import {
  projectKey as statusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { projectAtom, projectKey } from "@/atoms/projects"
import { projectKey as sprintsKey, sprintsListAtom } from "@/atoms/sprints"
import {
  ticketAtom,
  ticketKey,
  ticketsCountAtom,
  ticketsCountKey,
  ticketsListAtom,
  ticketsListKeyForStatus
} from "@/atoms/tickets"

import type { TicketId } from "@projectproject/shared"

export function preloadTicketPage(): Promise<unknown> {
  return import("@/components/TicketPage")
}

const projectTicketRowsPrefetchAtom = Atom.family((key: string) => {
  const separator = key.indexOf("/")
  const orgSlug = key.slice(0, separator)
  const slug = key.slice(separator + 1)
  return Atom.readable((get) => {
    const statuses = get(projectStatusesAtom(key))
    if (!Result.isSuccess(statuses)) return
    for (const status of statuses.value) {
      get(
        ticketsListAtom(
          ticketsListKeyForStatus(
            orgSlug,
            slug,
            ticketListQueryFromSearch({}),
            status.slug
          )
        )
      )
    }
  })
})

export function projectPrefetchAtoms(
  orgSlug: string,
  slug: string
): Array<Atom.Atom<unknown>> {
  return [
    projectAtom(projectKey(orgSlug, slug)),
    projectTicketRowsPrefetchAtom(projectKey(orgSlug, slug)),
    ticketsCountAtom(ticketsCountKey(orgSlug, slug, {})),
    sprintsListAtom(sprintsKey(orgSlug, slug)),
    projectStatusesAtom(statusKey(orgSlug, slug))
  ] as Array<Atom.Atom<unknown>>
}

export function ticketPrefetchAtoms(
  orgSlug: string,
  slug: string,
  id: TicketId
): Array<Atom.Atom<unknown>> {
  return [ticketAtom(ticketKey(orgSlug, slug, id))]
}

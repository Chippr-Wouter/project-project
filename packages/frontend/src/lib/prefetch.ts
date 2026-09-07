import type { Atom } from "@effect-atom/atom-react"
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
  ticketsCountKey
} from "@/atoms/tickets"
import type { TicketId } from "@projectproject/shared"

export function preloadTicketPage(): Promise<unknown> {
  return import("@/components/TicketPage")
}

export function projectPrefetchAtoms(
  orgSlug: string,
  slug: string
): Array<Atom.Atom<unknown>> {
  return [
    projectAtom(projectKey(orgSlug, slug)),
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

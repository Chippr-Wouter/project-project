import * as Atom from "effect/unstable/reactivity/Atom"
import {
  projectKey as statusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { projectAtom, projectKey } from "@/atoms/projects"
import { projectKey as sprintsKey, sprintsListAtom } from "@/atoms/sprints"
import { ticketsCountAtom, ticketsCountKey } from "@/atoms/tickets"

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

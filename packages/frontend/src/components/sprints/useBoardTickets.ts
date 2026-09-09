import { useAtomValue } from "@effect/atom-react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useMemo } from "react"
import { meAtom } from "@/atoms/auth"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { pendingTicketStatusAtom, sprintKey } from "@/atoms/sprints"
import { ticketsInSprintAtom, ticketsInSprintKey } from "@/atoms/tickets"
import { matchesTicketQuery } from "@projectproject/shared"
import type {
  GroupId,
  Ticket,
  TicketId,
  TicketListQuery,
  TicketStatus
} from "@projectproject/shared"
import { boardStatusesFor, effectiveStatus } from "./board-utils"

export interface BoardTickets {
  readonly ticketById: ReadonlyMap<TicketId, Ticket>
  readonly matchingTicketIds: ReadonlyArray<TicketId>
  readonly counts: Record<string, number>
}

export function useBoardTickets(
  orgSlug: string,
  slug: string,
  groupId: GroupId,
  ticketIds: ReadonlyArray<TicketId>,
  query: TicketListQuery
): BoardTickets {
  const list = useAtomValue(
    ticketsInSprintAtom(ticketsInSprintKey(orgSlug, slug, groupId))
  )
  const overlay = useAtomValue(
    pendingTicketStatusAtom(sprintKey(orgSlug, slug, groupId))
  )
  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const me = useAtomValue(meAtom)
  const viewerId = Result.isSuccess(me) ? me.value.id : ""

  const ticketById = useMemo(() => {
    const m = new Map<TicketId, Ticket>()
    if (Result.isSuccess(list)) {
      for (const t of list.value) m.set(t.id, t)
    }
    return m
  }, [list])

  const boardQuery = useMemo(() => {
    const { archived: _archived, ...filter } = query.filter ?? {}
    return { filter, q: query.q }
  }, [query])

  const matchingTicketIds = useMemo(
    () =>
      ticketIds.filter((tid) => {
        const ticket = ticketById.get(tid)
        if (!ticket) return true
        const status = effectiveStatus(ticket, overlay) as TicketStatus
        return matchesTicketQuery({ ...ticket, status }, boardQuery, viewerId)
      }),
    [ticketIds, ticketById, overlay, boardQuery, viewerId]
  )

  const statusSlugs = useMemo(
    () =>
      boardStatusesFor(
        Result.isSuccess(statusesResult) ? statusesResult.value : []
      ),
    [statusesResult]
  )

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: 0 }
    for (const status of statusSlugs) next[status] = 0
    for (const tid of matchingTicketIds) {
      const ticket = ticketById.get(tid)
      if (!ticket) continue
      next.all += 1
      const status = effectiveStatus(ticket, overlay)
      if (status in next) next[status] += 1
    }
    return next
  }, [matchingTicketIds, ticketById, overlay, statusSlugs])

  return { ticketById, matchingTicketIds, counts }
}

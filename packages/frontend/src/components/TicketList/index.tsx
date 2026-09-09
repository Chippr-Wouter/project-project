import { useState, type ReactNode } from "react"
import { useAtomValue } from "@effect/atom-react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import {
  ticketsListKey,
  ticketsSectionsAtom,
  ticketsSectionsKey,
  type TicketSectionsValue
} from "@/atoms/tickets"
import { ErrorPage } from "@/components/ErrorPage"
import { BacklogTicketCreator } from "./BacklogTicketCreator"
import { SegmentedList } from "./SegmentedList"
import { Toolbar } from "./Toolbar"
import type {
  Group,
  Member,
  Ticket,
  TicketId,
  TicketListQuery
} from "@projectproject/shared"

export function TicketList({
  orgSlug,
  slug,
  query,
  members,
  extraRowActions,
  sprintMembership,
  creator,
  showSprintFilter
}: {
  orgSlug: string
  slug: string
  query: TicketListQuery
  members: ReadonlyArray<Member>
  extraRowActions?: (ticket: Ticket) => ReactNode
  sprintMembership?: ReadonlyMap<TicketId, Group>
  creator?: ReactNode
  showSprintFilter?: boolean
}) {
  const key = ticketsListKey(orgSlug, slug, query)
  const result = useAtomValue(
    ticketsSectionsAtom(ticketsSectionsKey(orgSlug, slug, query))
  )
  const [previous, setPrevious] = useState<{
    key: string
    query: TicketListQuery
    value: TicketSectionsValue
  } | null>(null)
  if (
    Result.isSuccess(result) &&
    (previous?.key !== key || previous.value !== result.value)
  ) {
    setPrevious({ key, query, value: result.value })
  }
  const active = Result.isSuccess(result)
    ? { key, query, value: result.value }
    : previous
  const renderSections = () =>
    active ? (
      <SegmentedList
        key={active.key}
        orgSlug={orgSlug}
        slug={slug}
        query={active.query}
        snapshot={active.value}
        members={members}
        extraRowActions={extraRowActions}
        sprintMembership={sprintMembership}
      />
    ) : (
      <div
        aria-busy="true"
        className="h-96 animate-pulse rounded-lg bg-muted/40 motion-reduce:animate-none"
      />
    )

  return (
    <div className="group/list flex flex-col gap-3">
      {creator ?? (
        <BacklogTicketCreator orgSlug={orgSlug} slug={slug} query={query} />
      )}

      <div className="flex flex-col gap-3 transition-opacity duration-200 ease-out group-has-[form[data-active]]/list:opacity-35">
        <Toolbar
          orgSlug={orgSlug}
          slug={slug}
          query={query}
          members={members}
          showSprintFilter={showSprintFilter}
          ticketCounts={active?.value.counts}
        />

        <div aria-busy={result.waiting || Result.isInitial(result)}>
          {Result.matchWithError(result, {
            onInitial: renderSections,
            onError: (error) => <ErrorPage error={error} contained />,
            onDefect: (defect) => <ErrorPage error={defect} contained />,
            onSuccess: renderSections
          })}
        </div>
      </div>
    </div>
  )
}

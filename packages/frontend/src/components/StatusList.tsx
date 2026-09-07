import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { generateKeyBetween } from "fractional-indexing"
import { Reorder } from "motion/react"
import { useMemo, useRef, useState } from "react"
import type { ProjectStatus } from "@projectproject/shared"
import {
  projectKey,
  projectStatusesAtom,
  reorderStatusAtom
} from "@/atoms/projectStatuses"
import { ticketsCountAtom, ticketsCountKey } from "@/atoms/tickets"
import { ErrorPage } from "@/components/ErrorPage"
import { compareByOrderKey } from "@/components/sprints/board-utils"
import { StatusCreateRow } from "@/components/StatusCreateRow"
import { StatusRow } from "@/components/StatusRow"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

type Props = {
  orgSlug: string
  slug: string
}

export function StatusList({ orgSlug, slug }: Props) {
  const result = useAtomValue(projectStatusesAtom(projectKey(orgSlug, slug)))

  return Result.matchWithError(result, {
    onInitial: () => (
      <section className="flex w-full flex-col gap-2 text-sm text-muted-foreground">
        {m.tickets_status_loading()}
      </section>
    ),
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value, waiting }) => (
      <OrderedStatuses
        orgSlug={orgSlug}
        slug={slug}
        statuses={value}
        waiting={waiting}
      />
    )
  })
}

type OrderedProps = Props & {
  statuses: ReadonlyArray<ProjectStatus>
  waiting: boolean
}

function OrderedStatuses({ orgSlug, slug, statuses, waiting }: OrderedProps) {
  const key = projectKey(orgSlug, slug)
  const reorder = useAtomSet(reorderStatusAtom(key))
  useAtomValue(ticketsCountAtom(ticketsCountKey(orgSlug, slug, {})))

  const sorted = useMemo(
    () => [...statuses].toSorted(compareByOrderKey),
    [statuses]
  )

  const [dragOrder, setDragOrder] =
    useState<ReadonlyArray<ProjectStatus> | null>(null)
  const order = dragOrder ?? sorted
  const orderRef = useRef(order)
  orderRef.current = order

  const commitDrop = (statusSlug: string) => {
    const list = orderRef.current
    const idx = list.findIndex((s) => s.slug === statusSlug)
    if (idx < 0) {
      setDragOrder(null)
      return
    }
    if (sorted[idx]?.slug === statusSlug) {
      setDragOrder(null)
      return
    }
    const prevKey = list[idx - 1]?.orderKey ?? null
    const nextKey = list[idx + 1]?.orderKey ?? null
    const newKey = generateKeyBetween(prevKey, nextKey)
    reorder({ statusSlug, orderKey: newKey })
    setDragOrder(null)
  }

  const moveBy = (statusSlug: string, delta: number) => {
    const idx = sorted.findIndex((s) => s.slug === statusSlug)
    const targetIdx = idx + delta
    if (idx < 0 || targetIdx < 0 || targetIdx >= sorted.length) return
    const next = [...sorted]
    const [moved] = next.splice(idx, 1)
    next.splice(targetIdx, 0, moved)
    const prevKey = next[targetIdx - 1]?.orderKey ?? null
    const nextKey = next[targetIdx + 1]?.orderKey ?? null
    const newKey = generateKeyBetween(prevKey, nextKey)
    reorder({ statusSlug, orderKey: newKey })
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <Reorder.Group
        as="ul"
        axis="y"
        values={order as ProjectStatus[]}
        onReorder={(next) => setDragOrder(next)}
        className={cn("flex flex-col gap-0.5", waiting && "animate-pulse")}
      >
        {order.map((s, i) => (
          <StatusRow
            key={s.slug}
            status={s}
            statuses={order}
            orgSlug={orgSlug}
            slug={slug}
            onDragStart={() => {
              if (dragOrder === null) setDragOrder(sorted)
            }}
            onDragEnd={() => commitDrop(s.slug)}
            onMoveUp={i > 0 ? () => moveBy(s.slug, -1) : undefined}
            onMoveDown={
              i < order.length - 1 ? () => moveBy(s.slug, +1) : undefined
            }
          />
        ))}
      </Reorder.Group>
      <StatusCreateRow orgSlug={orgSlug} slug={slug} />
    </section>
  )
}

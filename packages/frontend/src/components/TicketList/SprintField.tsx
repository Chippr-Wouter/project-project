import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { Plus } from "lucide-react"
import { useState } from "react"
import { SprintStateIcon } from "@/components/sprints/SprintChip"
import { SprintAssignMenu } from "@/components/sprints/SprintAssignMenu"
import { Button } from "@/components/ui/button"
import { Hitbox } from "@/components/ui/hitbox"
import { m } from "@/paraglide/messages"
import {
  projectKey,
  sprintMembershipAtom,
  sprintsListAtom,
  useAddTicketsToSprint,
  useRemoveTicketsFromSprint
} from "@/atoms/sprints"
import { type Group, type TicketId } from "@projectproject/shared"

export function SprintField({
  orgSlug,
  slug,
  ticketId,
  membership,
  onRequestNewSprint
}: {
  orgSlug: string
  slug: string
  ticketId: TicketId
  membership: Group | null
  onRequestNewSprint?: () => void
}) {
  const key = projectKey(orgSlug, slug)
  const list = useAtomValue(sprintsListAtom(key))
  const addToSprint = useAddTicketsToSprint(key)
  const removeFromSprint = useRemoveTicketsFromSprint(key)
  const [open, setOpen] = useState(false)

  if (!membership) return null

  const sprints = Result.isSuccess(list) ? list.value : []

  return (
    <SprintAssignMenu
      open={open}
      onOpenChange={setOpen}
      sprints={sprints}
      selectedId={membership.id}
      onSelect={(s) => addToSprint({ groupId: s.id, ticketIds: [ticketId] })}
      onClear={() =>
        removeFromSprint({
          groupId: membership.id,
          ticketIds: [ticketId]
        })
      }
      onRequestNewSprint={onRequestNewSprint}
      trigger={
        <Hitbox
          mode="inline"
          margin="2"
          onClick={(e) => e.stopPropagation()}
          aria-label={m.tickets_sprint_chip_aria({ name: membership.name })}
          className="min-w-0"
        >
          <span className="inline-flex max-w-[14ch] items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors group-hover/hitbox:bg-foreground/5 group-hover/hitbox:text-foreground">
            <SprintStateIcon sprint={membership} size="xs" />
            <span className="truncate">{membership.name}</span>
          </span>
        </Hitbox>
      }
    />
  )
}

export function SprintBadgeTrigger({
  orgSlug,
  slug,
  ticketId,
  className
}: {
  orgSlug: string
  slug: string
  ticketId: TicketId
  className?: string
}) {
  const key = projectKey(orgSlug, slug)
  const list = useAtomValue(sprintsListAtom(key))
  const membership = useAtomValue(sprintMembershipAtom(key))
  const addToSprint = useAddTicketsToSprint(key)
  const removeFromSprint = useRemoveTicketsFromSprint(key)
  const [open, setOpen] = useState(false)
  const sprints = Result.isSuccess(list) ? list.value : []
  const hasAnyEligible = sprints.some((s) => s.completedAt === null)
  const current = membership?.get(ticketId) ?? null
  const label = current?.name ?? m.tickets_assign_sprint_chip()

  if (!hasAnyEligible) return null

  return (
    <SprintAssignMenu
      open={open}
      onOpenChange={setOpen}
      sprints={sprints}
      selectedId={current?.id ?? null}
      onSelect={(s) => addToSprint({ groupId: s.id, ticketIds: [ticketId] })}
      onClear={
        current
          ? () =>
              removeFromSprint({
                groupId: current.id,
                ticketIds: [ticketId]
              })
          : undefined
      }
      trigger={
        <Button
          type="button"
          variant="chip"
          onClick={(e) => e.stopPropagation()}
          aria-label={
            current
              ? m.tickets_sprint_chip_aria({ name: current.name })
              : m.tickets_assign_sprint_chip()
          }
          className={className}
        >
          {current ? (
            <SprintStateIcon sprint={current} size="xs" />
          ) : (
            <Plus className="size-3.5" strokeWidth={1.75} />
          )}
          <span className="max-w-[14ch] truncate">{label}</span>
        </Button>
      }
    />
  )
}

import { useAtomSet } from "@effect/atom-react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hitbox } from "@/components/ui/hitbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { TYPE_LABELS, TYPE_META } from "@/lib/ticket-meta"
import { m } from "@/paraglide/messages"
import { ticketKey, updateTicketAtom } from "@/atoms/tickets"
import type { TicketId, TicketType } from "@projectproject/shared"

export function TypeBadgeTrigger({
  orgSlug,
  slug,
  ticket,
  className
}: {
  orgSlug: string
  slug: string
  ticket: { id: TicketId; type: TicketType }
  className?: string
}) {
  const update = useAtomSet(
    updateTicketAtom(ticketKey(orgSlug, slug, ticket.id))
  )
  const meta = TYPE_META[ticket.type]
  const Icon = meta.icon
  const typeLabel = TYPE_LABELS[ticket.type]()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="chip"
            onClick={(e) => e.stopPropagation()}
            aria-label={m.tickets_type_aria_label({ label: typeLabel })}
            className={className}
          >
            <Icon className="size-3.5" strokeWidth={1.75} />
            <span>{typeLabel}</span>
          </Button>
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-40"
        finalFocus={false}
        onClick={(e) => e.stopPropagation()}
      >
        {(Object.keys(TYPE_META) as TicketType[]).map((t) => {
          const tMeta = TYPE_META[t]
          const TIcon = tMeta.icon
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => {
                if (t === ticket.type) return
                update({ type: t })
              }}
              className="cursor-pointer"
            >
              <TIcon className="size-4" strokeWidth={1.75} />
              {TYPE_LABELS[t]()}
              {t === ticket.type && (
                <Check className="ml-auto size-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TypeButton({
  orgSlug,
  slug,
  ticket,
  className,
  iconOnly,
  sprintTicketsKey
}: {
  orgSlug: string
  slug: string
  ticket: { id: TicketId; type: TicketType }
  className?: string
  iconOnly?: boolean
  sprintTicketsKey?: string
}) {
  const update = useAtomSet(
    updateTicketAtom(ticketKey(orgSlug, slug, ticket.id))
  )
  const meta = TYPE_META[ticket.type]
  const Icon = meta.icon
  const typeLabel = TYPE_LABELS[ticket.type]()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          iconOnly ? (
            <Hitbox
              mode="inline"
              margin="2"
              onClick={(e) => e.stopPropagation()}
              aria-label={m.tickets_type_aria_label({ label: typeLabel })}
              className={className}
            >
              <span className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors group-hover/hitbox:bg-foreground/5 group-hover/hitbox:text-foreground">
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
            </Hitbox>
          ) : (
            <Hitbox
              mode="inline"
              margin="2"
              onClick={(e) => e.stopPropagation()}
              aria-label={m.tickets_type_aria_label({ label: typeLabel })}
              className={className}
            >
              <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors group-hover/hitbox:bg-foreground/5 group-hover/hitbox:text-foreground">
                <Icon className="size-3.5" strokeWidth={1.75} />
                <span className="grid justify-items-start whitespace-nowrap">
                  {Object.entries(TYPE_LABELS).map(([type, label]) => (
                    <span
                      key={type}
                      aria-hidden="true"
                      className="invisible col-start-1 row-start-1"
                    >
                      {label()}
                    </span>
                  ))}
                  <span className="col-start-1 row-start-1">{typeLabel}</span>
                </span>
              </span>
            </Hitbox>
          )
        }
      />
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="w-40"
        onClick={(e) => e.stopPropagation()}
      >
        {(Object.keys(TYPE_META) as TicketType[]).map((t) => {
          const tMeta = TYPE_META[t]
          const TIcon = tMeta.icon
          return (
            <DropdownMenuItem
              key={t}
              onClick={() => {
                if (t === ticket.type) return
                update({ type: t, sprintTicketsKey })
              }}
              className="cursor-pointer"
            >
              <TIcon className="size-4" strokeWidth={1.75} />
              {TYPE_LABELS[t]()}
              {t === ticket.type && (
                <Check className="ml-auto size-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

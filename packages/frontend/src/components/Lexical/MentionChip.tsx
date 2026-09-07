import { Link } from "@tanstack/react-router"
import * as Schema from "effect/Schema"
import { Badge } from "@/components/ui/badge"
import { MemberAvatar } from "@/components/MemberAvatar"
import { Popover, PopoverTrigger } from "@/components/ui/popover"
import { TicketHoverCard } from "@/components/TicketHoverCard"
import { useMentionScope } from "@/mentions/scope"
import { TicketId, type MentionType } from "@projectproject/shared"

const makeTicketId = Schema.decodeUnknownSync(TicketId)

export function MentionChip({
  type,
  id,
  label
}: {
  type: MentionType
  id: string
  label: string
}) {
  const scope = useMentionScope()
  if (type === "user") {
    const member = scope?.members?.find((m) => m.id === id)
    return (
      <Badge
        tone="blue"
        size="xs"
        render={
          scope ? (
            <Link
              to="/orgs/$orgSlug/projects/$slug/settings/team"
              params={{ orgSlug: scope.orgSlug, slug: scope.slug }}
              onMouseDown={(e) => e.preventDefault()}
            />
          ) : undefined
        }
        className="align-middle"
        contentEditable={false}
      >
        {member && (
          <MemberAvatar member={member} size={12} className="-ml-0.5" />
        )}
        <span>@{member?.name ?? label}</span>
      </Badge>
    )
  }

  if (!scope) {
    return (
      <Badge
        tone="muted"
        size="xs"
        className="font-mono align-middle"
        contentEditable={false}
      >
        {id}
      </Badge>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Link
            to="/orgs/$orgSlug/projects/$slug/tickets/$id"
            params={{ orgSlug: scope.orgSlug, slug: scope.slug, id }}
            onMouseDown={(e) => e.preventDefault()}
          />
        }
        openOnHover
        contentEditable={false}
      >
        <Badge
          tone="muted"
          size="xs"
          className="font-mono align-middle"
          contentEditable={false}
        >
          {id}
        </Badge>
      </PopoverTrigger>
      <TicketHoverCard ticketId={makeTicketId(id)} scope={scope} />
    </Popover>
  )
}

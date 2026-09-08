import * as Effect from "effect/Effect"
import { extractMentionLinks, MentionInvalid } from "@projectproject/shared"

export const validateBodyMentions = (
  body: string,
  memberIds: ReadonlySet<string>,
  ticketIds: ReadonlySet<string>
): Effect.Effect<void, MentionInvalid> =>
  Effect.gen(function* () {
    const links = extractMentionLinks(body)
    for (const link of links) {
      if (!link.parsed) {
        return yield* new MentionInvalid({
          kind: "malformed_href",
          href: link.href
        })
      }
      if (link.label.trim() === "") {
        return yield* new MentionInvalid({
          kind: "empty_label",
          href: link.href
        })
      }
      if (link.parsed.type === "user" && !memberIds.has(link.parsed.id)) {
        return yield* new MentionInvalid({
          kind: "unknown_user",
          href: link.href
        })
      }
      if (link.parsed.type === "ticket" && !ticketIds.has(link.parsed.id)) {
        return yield* new MentionInvalid({
          kind: "unknown_ticket",
          href: link.href
        })
      }
    }
  })

export const validateBodyMentionsWithLookups = <TicketError, MemberError>(
  body: string,
  lookups: {
    readonly existingTicketIds: (
      ticketIds: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlySet<string>, TicketError>
    readonly memberIds: () => Effect.Effect<ReadonlySet<string>, MemberError>
  }
): Effect.Effect<void, MentionInvalid | TicketError | MemberError> => {
  if (!body.includes("](mention:")) return Effect.void
  return Effect.gen(function* () {
    const links = extractMentionLinks(body)
    const referencedTicketIds = [
      ...new Set(
        links.flatMap((link) =>
          link.parsed?.type === "ticket" ? [link.parsed.id] : []
        )
      )
    ]
    const ticketIds = yield* lookups.existingTicketIds(referencedTicketIds)
    const hasUserMentions = links.some((link) => link.parsed?.type === "user")
    const memberIds = hasUserMentions
      ? yield* lookups.memberIds()
      : new Set<string>()
    yield* validateBodyMentions(body, memberIds, ticketIds)
  })
}

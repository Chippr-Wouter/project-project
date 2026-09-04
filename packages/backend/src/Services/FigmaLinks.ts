import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  FigmaLinkMetadata,
  Forbidden,
  NotFound
} from "@projectproject/shared"

export interface FigmaReferencePlan {
  readonly added: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
}

export const planFigmaReferences = (input: {
  readonly existing: ReadonlySet<string>
  readonly referenced: ReadonlySet<string>
}): FigmaReferencePlan => ({
  added: [...input.referenced].filter((key) => !input.existing.has(key)),
  removed: [...input.existing].filter((key) => !input.referenced.has(key))
})

export interface FigmaLinksShape {
  readonly reconcileTicket: (
    orgSlug: string,
    slug: string,
    ticketId: string,
    body: string
  ) => Effect.Effect<void>
  readonly listForTicket: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: string
  ) => Effect.Effect<ReadonlyArray<FigmaLinkMetadata>, NotFound | Forbidden>
}

export class FigmaLinks extends Context.Tag(
  "@projectproject/backend/Services/FigmaLinks"
)<FigmaLinks, FigmaLinksShape>() {}

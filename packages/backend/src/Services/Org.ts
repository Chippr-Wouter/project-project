import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  Conflict,
  Forbidden,
  NotFound,
  Org as OrgSummary,
  OrgDetail
} from "@projectproject/shared"

export interface OrgShape {
  readonly myOrgs: (userId: string) => Effect.Effect<ReadonlyArray<OrgSummary>>
  readonly get: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<OrgDetail, NotFound>
  readonly softDelete: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<OrgDetail, NotFound | Forbidden>
  readonly restore: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<OrgDetail, NotFound | Forbidden | Conflict>
}

export class Org extends Context.Service<Org, OrgShape>()(
  "@projectproject/backend/Services/Org"
) {}

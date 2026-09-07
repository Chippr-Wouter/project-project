import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { NotFound, OAuthApplication } from "@projectproject/shared"

export interface OAuthApplicationsShape {
  readonly listForUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<OAuthApplication>>
  readonly revokeForUser: (
    userId: string,
    applicationId: string
  ) => Effect.Effect<void, NotFound>
}

export class OAuthApplications extends Context.Service<
  OAuthApplications,
  OAuthApplicationsShape
>()("@projectproject/backend/Services/OAuthApplications") {}

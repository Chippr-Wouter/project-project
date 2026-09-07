import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  EverhourApiKeyMissing,
  EverhourAuthInvalid,
  EverhourConfigMissing,
  EverhourError,
  EverhourProjectIntegrationStatus,
  EverhourRateLimited,
  EverhourSyncSummary,
  Forbidden,
  NotFound,
  PersonalEverhour
} from "@projectproject/shared"

export type EverhourIntegrationError =
  | NotFound
  | Forbidden
  | EverhourApiKeyMissing
  | EverhourAuthInvalid
  | EverhourRateLimited
  | EverhourConfigMissing
  | EverhourError

export interface EverhourIntegrationsShape {
  readonly getProfile: (userId: string) => Effect.Effect<PersonalEverhour>
  readonly connectProfile: (
    userId: string,
    apiKey: string
  ) => Effect.Effect<
    PersonalEverhour,
    | EverhourAuthInvalid
    | EverhourRateLimited
    | EverhourConfigMissing
    | EverhourError
  >
  readonly disconnectProfile: (
    userId: string
  ) => Effect.Effect<PersonalEverhour>
  readonly getProjectStatus: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<EverhourProjectIntegrationStatus, NotFound>
  readonly connectProject: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<EverhourSyncSummary, EverhourIntegrationError>
  readonly syncProject: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<EverhourSyncSummary, EverhourIntegrationError>
  readonly disconnectProject: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<EverhourProjectIntegrationStatus, NotFound | Forbidden>
  readonly bestEffortProjectSync: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<void>
}

export class EverhourIntegrations extends Context.Service<
  EverhourIntegrations,
  EverhourIntegrationsShape
>()("@projectproject/backend/Services/EverhourIntegrations") {}

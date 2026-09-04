import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected,
  FigmaProjectIntegrationStatus,
  FigmaRateLimited,
  Forbidden,
  NotFound,
  PersonalFigma,
  StorageNotConnected
} from "@projectproject/shared"
import type { FigmaCredential } from "./Figma"

export const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000

export const isTokenExpired = (expiresAt: Date, now: Date): boolean =>
  expiresAt.getTime() - now.getTime() <= TOKEN_EXPIRY_SKEW_MS

export const chooseCredential = (input: {
  readonly personalToken: string | null
  readonly projectToken: string | null
}): FigmaCredential | null => {
  if (input.personalToken !== null) {
    return { _tag: "Bearer", token: input.personalToken }
  }
  if (input.projectToken !== null) {
    return { _tag: "FigmaToken", token: input.projectToken }
  }
  return null
}

export type FigmaIntegrationError =
  | NotFound
  | Forbidden
  | FigmaNotConnected
  | FigmaAuthInvalid
  | FigmaRateLimited
  | FigmaError

export interface FigmaIntegrationsShape {
  readonly getProfile: (userId: string) => Effect.Effect<PersonalFigma>
  readonly beginProfileConnect: (
    userId: string
  ) => Effect.Effect<{ readonly authorizeUrl: string; readonly state: string }>
  readonly completeProfileConnect: (
    userId: string,
    code: string,
    state: string
  ) => Effect.Effect<PersonalFigma, FigmaAuthInvalid | FigmaError>
  readonly disconnectProfile: (userId: string) => Effect.Effect<PersonalFigma>
  readonly getProjectStatus: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<FigmaProjectIntegrationStatus, NotFound>
  readonly connectProject: (
    orgSlug: string,
    userId: string,
    slug: string,
    accessToken: string
  ) => Effect.Effect<
    FigmaProjectIntegrationStatus,
    FigmaIntegrationError | StorageNotConnected
  >
  readonly disconnectProject: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<FigmaProjectIntegrationStatus, NotFound | Forbidden>
  readonly credentialFor: (
    orgSlug: string,
    slug: string,
    userId: string | null
  ) => Effect.Effect<
    FigmaCredential,
    FigmaNotConnected | FigmaAuthInvalid | FigmaError
  >
}

export class FigmaIntegrations extends Context.Tag(
  "@projectproject/backend/Services/FigmaIntegrations"
)<FigmaIntegrations, FigmaIntegrationsShape>() {}

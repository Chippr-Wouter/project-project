import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  Forbidden,
  GitHubError,
  GithubOrgIntegrationStatus,
  GithubRepoPage,
  NotFound,
  RateLimited,
  RepoGone,
  Slug
} from "@projectproject/shared"

export interface GitHubIntegrationsShape {
  readonly getStatus: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<GithubOrgIntegrationStatus, NotFound>
  readonly startInstall: (
    orgSlug: string,
    userId: string,
    returnProjectSlug: Slug | null | undefined
  ) => Effect.Effect<{ installUrl: string }, NotFound | Forbidden | GitHubError>
  readonly completeSetup: (
    state: string,
    installationId: string
  ) => Effect.Effect<{ authorizeUrl: string }, NotFound | GitHubError>
  readonly completeCallback: (
    state: string,
    code: string
  ) => Effect.Effect<
    { redirectUrl: string },
    NotFound | Forbidden | RateLimited | GitHubError
  >
  readonly listRepos: (
    orgSlug: string,
    userId: string,
    query: string | undefined,
    page: number
  ) => Effect.Effect<
    GithubRepoPage,
    NotFound | Forbidden | RepoGone | RateLimited | GitHubError
  >
}

export class GitHubIntegrations extends Context.Service<
  GitHubIntegrations,
  GitHubIntegrationsShape
>()("@projectproject/backend/Services/GitHubIntegrations") {}

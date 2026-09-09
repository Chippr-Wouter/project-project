import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  BranchExists,
  BranchListResponse,
  BranchProtected,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  GithubRepoPage,
  RateLimited,
  RepoGone
} from "@projectproject/shared"

export interface RawBranchEntry {
  readonly headRefName: string
  readonly baseRefName: string
  readonly state: "open" | "closed" | "merged"
  readonly draft: boolean
  readonly number: number
  readonly url: string
  readonly title: string
  readonly mergedAt: Date | null
  readonly checks: ChecksStatus
}

export type ChecksStatus =
  | "passing"
  | "failing"
  | "pending"
  | "neutral"
  | "none"

export interface RawProjectStates {
  readonly defaultBranch: string
  readonly existingBranches: ReadonlySet<string>
  readonly prByBranch: ReadonlyMap<string, RawBranchEntry>
  readonly fetchedAt?: Date
  readonly refreshStatus?: "stale" | "rate_limited"
  readonly retryAt?: number
}

export interface GitHubInstallationAccount {
  readonly installationId: string
  readonly accountId: string
  readonly accountLogin: string
  readonly accountType: "User" | "Organization"
}

export interface VerifiedInstallationRepo {
  readonly repoId: string
  readonly owner: string
  readonly name: string
  readonly defaultBranch: string
}

export interface GitHubShape {
  readonly getInstallationAccount: (
    installationId: string
  ) => Effect.Effect<
    GitHubInstallationAccount,
    RepoGone | RateLimited | GitHubError
  >
  readonly listInstallationRepos: (
    installationId: string,
    query: string | undefined,
    page: number
  ) => Effect.Effect<GithubRepoPage, RepoGone | RateLimited | GitHubError>
  readonly verifyInstallationRepo: (
    installationId: string,
    owner: string,
    name: string
  ) => Effect.Effect<
    VerifiedInstallationRepo,
    RepoGone | RateLimited | GitHubError
  >
  readonly exchangeAppUserCode: (
    code: string
  ) => Effect.Effect<string, GitHubError>
  readonly appUserCanAccessInstallation: (
    userAccessToken: string,
    installationId: string
  ) => Effect.Effect<boolean, RateLimited | GitHubError>
  readonly createBranchAsUser: (
    owner: string,
    name: string,
    branchName: string,
    baseBranch: string,
    userId: string
  ) => Effect.Effect<
    { name: string; sha: string },
    | GitHubTokenExpired
    | GitHubScopeInsufficient
    | RepoGone
    | BranchExists
    | BranchProtected
    | RateLimited
    | GitHubError
  >
  readonly openPullRequestAsUser: (
    owner: string,
    name: string,
    args: {
      readonly head: string
      readonly base: string
      readonly title: string
      readonly body: string
      readonly draft: boolean
    },
    userId: string
  ) => Effect.Effect<
    { number: number; url: string },
    | GitHubTokenExpired
    | GitHubScopeInsufficient
    | RepoGone
    | BranchProtected
    | RateLimited
    | GitHubError
  >
  readonly fetchInstallationProjectStates: (
    installationId: string,
    owner: string,
    name: string,
    branches: ReadonlyArray<string>,
    branchQuery?: string
  ) => Effect.Effect<RawProjectStates, RepoGone | RateLimited | GitHubError>
  readonly listInstallationBranches: (
    installationId: string,
    owner: string,
    name: string,
    query: string | undefined,
    first: number
  ) => Effect.Effect<BranchListResponse, RepoGone | RateLimited | GitHubError>
  readonly branchExistsInstallation: (
    installationId: string,
    owner: string,
    name: string,
    branch: string
  ) => Effect.Effect<boolean, RepoGone | RateLimited | GitHubError>
}

export class GitHub extends Context.Service<GitHub, GitHubShape>()(
  "@projectproject/backend/Services/GitHub"
) {}

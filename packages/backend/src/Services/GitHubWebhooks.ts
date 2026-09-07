import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type { ChecksStatus, GitHubError } from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"

export type GitHubWebhookHandleError = GitHubError | MarkdownError

export interface GitHubWebhookDelivery {
  readonly event: string
  readonly deliveryId: string | null
  readonly body: string
}

export interface GitHubPullRequestWebhookChange {
  readonly installationId: string
  readonly repositoryId: string
  readonly branch: string
  readonly number: number
  readonly state: "open" | "closed" | "merged"
}

export interface GitHubRepositoryMetadataChange {
  readonly installationId: string
  readonly repoId: string
  readonly owner: string
  readonly name: string
  readonly defaultBranch: string
}

export interface GitHubBranchDeletionChange {
  readonly installationId: string
  readonly repositoryId: string
  readonly branch: string
}

export interface GitHubCheckWebhookChange {
  readonly installationId: string
  readonly repositoryId: string
  readonly branch: string
  readonly headSha: string
  readonly checks: ChecksStatus
  readonly updatedAt: Date
}

export interface GitHubWebhookMutationSink {
  readonly installationDeleted: (
    installationId: string,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly installationSuspended: (
    installationId: string,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly installationUnsuspended: (
    installationId: string,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly repositoriesRemoved: (
    installationId: string,
    repoIds: ReadonlyArray<string>,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly repositoryRenamed: (
    change: GitHubRepositoryMetadataChange,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly repositoryTransferred: (
    change: GitHubRepositoryMetadataChange,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly repositoryArchived: (
    installationId: string,
    repoId: string,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly repositoryUnarchived: (
    installationId: string,
    repoId: string,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly repositoryDeleted: (
    installationId: string,
    repoId: string,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly pullRequestChanged: (
    change: GitHubPullRequestWebhookChange,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly branchDeleted: (
    change: GitHubBranchDeletionChange,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
  readonly checkStateChanged: (
    change: GitHubCheckWebhookChange,
    deliveryId: string | null
  ) => Effect.Effect<void, GitHubWebhookHandleError>
}

export interface GitHubWebhooksShape {
  readonly handle: (
    delivery: GitHubWebhookDelivery
  ) => Effect.Effect<void, GitHubWebhookHandleError>
}

export class GitHubWebhooks extends Context.Service<
  GitHubWebhooks,
  GitHubWebhooksShape
>()("@projectproject/backend/Services/GitHubWebhooks") {}

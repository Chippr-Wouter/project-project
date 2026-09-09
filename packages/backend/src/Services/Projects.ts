import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  AddMemberInput,
  AssignableRole,
  ConnectGithubInput,
  Conflict,
  CreateProjectInput,
  CursorPayload,
  Forbidden,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  Member,
  NotFound,
  Project,
  ProjectDetail,
  ProjectKey,
  ProjectOwnerRemovalBlocked,
  RateLimited,
  RepoGone,
  Role,
  Validation,
  UpdateProjectInput,
  UpdateProjectSetupInput
} from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"
import type { MalformedTicketDocument } from "./TicketDocs"

export interface ProjectMembership {
  readonly role: Role
}

export interface ProjectGithubIntegration {
  readonly projectIntegrationLinkId: string
  readonly organizationId: string
  readonly projectId: string
  readonly projectSlug: string
  readonly installationId: string
  readonly repoId: string
  readonly repoOwner: string
  readonly repoName: string
  readonly defaultBaseBranch: string
}

export interface ProjectsShape {
  readonly list: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<ReadonlyArray<Project>, NotFound>
  readonly listPaged: (
    orgSlug: string,
    userId: string,
    cursor: CursorPayload | undefined,
    limit: number
  ) => Effect.Effect<
    {
      items: ReadonlyArray<Project>
      nextCursor: string | null
    },
    NotFound
  >
  readonly listMembersPaged: (
    orgSlug: string,
    userId: string,
    slug: string,
    cursor: CursorPayload | undefined,
    limit: number
  ) => Effect.Effect<
    { items: ReadonlyArray<Member>; nextCursor: string | null },
    NotFound
  >
  readonly create: (
    orgSlug: string,
    createdBy: string,
    input: CreateProjectInput
  ) => Effect.Effect<Project, NotFound | Conflict>
  readonly get: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ProjectDetail, NotFound | MarkdownError>
  readonly getKey: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ProjectKey, NotFound>
  readonly getGithubIntegration: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ProjectGithubIntegration | null, NotFound>
  readonly update: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: UpdateProjectInput
  ) => Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError>
  readonly updateSetup: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: UpdateProjectSetupInput
  ) => Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError>
  readonly remove: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<void, NotFound | Forbidden | MarkdownError>
  readonly requireMember: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ProjectMembership, NotFound>
  readonly requireRole: (
    orgSlug: string,
    userId: string,
    slug: string,
    allowed: ReadonlyArray<Role>
  ) => Effect.Effect<ProjectMembership, NotFound | Forbidden>
  readonly addMember: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: AddMemberInput
  ) => Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError>
  readonly updateMember: (
    orgSlug: string,
    userId: string,
    slug: string,
    targetUserId: string,
    nextRole: AssignableRole
  ) => Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError>
  readonly transferOwnership: (
    orgSlug: string,
    userId: string,
    slug: string,
    targetUserId: string
  ) => Effect.Effect<
    ProjectDetail,
    NotFound | Forbidden | Validation | MarkdownError
  >
  readonly removeMember: (
    orgSlug: string,
    userId: string,
    slug: string,
    targetUserId: string
  ) => Effect.Effect<
    ProjectDetail,
    | NotFound
    | Forbidden
    | MarkdownError
    | MalformedTicketDocument
    | ProjectOwnerRemovalBlocked
  >
  readonly cancelPendingMember: (
    orgSlug: string,
    userId: string,
    slug: string,
    invitationId: string
  ) => Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError>
  readonly unassignUserFromActiveTickets: (
    orgSlug: string,
    slug: string,
    userId: string
  ) => Effect.Effect<void, MarkdownError | MalformedTicketDocument>
  readonly connectGithub: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: ConnectGithubInput
  ) => Effect.Effect<
    ProjectDetail,
    | NotFound
    | Forbidden
    | Conflict
    | GitHubTokenExpired
    | GitHubScopeInsufficient
    | RepoGone
    | RateLimited
    | GitHubError
    | MarkdownError
  >
  readonly disconnectGithub: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ProjectDetail, NotFound | Forbidden | MarkdownError>
}

export class Projects extends Context.Service<Projects, ProjectsShape>()(
  "@projectproject/backend/Services/Projects"
) {}

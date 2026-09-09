// packages/shared/src/api.ts
//
// THIS FILE IS THE CONTRACT.
// ----------------------------------------------------------------------------
// ProjectProject's HTTP API is defined here, once. The backend implements it; the
// frontend consumes it via `HttpApiClient.make(AppApi)`; the OpenAPI spec is
// derived from it. There is no code generation step — the *type* of `AppApi`
// is what flows into both ends.
//
// ORG-SCOPED PATHS (T-05)
// ----------------------------------------------------------------------------
// Every project- and ticket-scoped endpoint is nested under
// `/orgs/:orgSlug/...`. Handlers read `path.orgSlug` and use it to scope all
// downstream service calls. The `:orgSlug` is the URL-canonical source of
// "which org am I acting in?" — see `services/CurrentOrg.ts` for the resolver.

import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi
} from "effect/unstable/httpapi"
import * as Schema from "effect/Schema"
import { User } from "./schemas/User"
import { Org, OrgDetail } from "./schemas/Org"
import {
  AddMemberInput,
  ConnectGithubInput,
  CreateProjectInput,
  GithubRepoPage,
  GithubOrgIntegrationStatus,
  Project,
  ProjectDetail,
  Slug,
  StartGithubInstallInput,
  StartGithubInstallResponse,
  TransferOwnershipInput,
  UpdateMemberInput,
  UpdateProjectInput,
  UpdateProjectSetupInput
} from "./schemas/Project"
import {
  ArchiveTicketInput,
  CreateTicketInput,
  QuickCreateTicketInput,
  Ticket,
  TicketDetail,
  TicketId,
  UpdateTicketInput
} from "./schemas/Ticket"
import {
  AttachBranchInput,
  BranchListResponse,
  CreateBranchInput,
  GitStatesResponse,
  OpenPrInput,
  OpenPrResult
} from "./schemas/GitState"
import { CreateTagInput, Tag, TagName, UpdateTagInput } from "./schemas/Tag"
import {
  CreateStatusInput,
  ProjectStatus,
  ReorderStatusInput,
  StatusSlug,
  UpdateStatusInput
} from "./schemas/Status"
import {
  Comment,
  CommentId,
  CreateCommentInput,
  UpdateCommentInput
} from "./schemas/Comment"
import { OAuthApplication } from "./schemas/OAuthApplication"
import {
  ConnectEverhourProfileInput,
  EverhourProjectIntegrationStatus,
  EverhourSyncSummary,
  PersonalEverhour
} from "./schemas/Everhour"
import {
  ActiveTimer,
  LogTimeInput,
  StartSprintTimerInput,
  StartTimerInput,
  TicketTimeSummary,
  WorkTypeOption
} from "./schemas/TimeTracking"
import {
  ConnectFigmaProjectInput,
  FigmaLinkMetadata,
  FigmaProjectIntegrationStatus,
  PersonalFigma
} from "./schemas/Figma"
import {
  CompleteSprintInput,
  CreateGroupInput,
  Group,
  GroupDetail,
  GroupId,
  UpdateGroupInput,
  UpdateGroupTicketsInput,
  UpdateGroupTicketsOutput,
  UpdateTicketOrderInput
} from "./schemas/Group"
import { TicketCounts, TicketListPage, TicketSections } from "./filters/Ticket"
import { TicketCountParams, TicketListParams } from "./filters/url"
import {
  Attachment,
  AttachmentListPage,
  AttachmentListParams,
  AttachmentSummary,
  ConnectStorageInput,
  OrgStorageStatus,
  PrepareAttachmentInput,
  PrepareAttachmentResult
} from "./schemas/Attachment"
import {
  AttachmentNotUploaded,
  AttachmentTooLarge,
  AttachmentTypeRejected,
  BranchExists,
  BranchNotFound,
  BranchProtected,
  Conflict,
  EverhourApiKeyMissing,
  EverhourAuthInvalid,
  EverhourConfigMissing,
  EverhourError,
  EverhourRateLimited,
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected,
  FigmaRateLimited,
  Forbidden,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  MentionInvalid,
  NotFound,
  ProjectOwnerRemovalBlocked,
  RateLimited,
  RepoGone,
  SprintCompletedImmutable,
  StorageAuthInvalid,
  StorageConfigMissing,
  StorageError,
  StorageNotConnected,
  Unauthorized,
  Validation
} from "./errors"
import { Authentication } from "./Authentication"

const HealthResponse = Schema.Struct({
  status: Schema.Literal("ok")
})
export type HealthResponse = typeof HealthResponse.Type

const HealthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("get", "/health", {
    success: HealthResponse
  })
)

const DbPingResponse = Schema.Struct({
  projectCount: Schema.Finite
})
export type DbPingResponse = typeof DbPingResponse.Type

const DbGroup = HttpApiGroup.make("db").add(
  HttpApiEndpoint.get("ping", "/db/ping", {
    success: DbPingResponse
  })
)

const AuthGroup = HttpApiGroup.make("auth")
  .add(
    HttpApiEndpoint.get("me", "/me", {
      success: User,
      error: Unauthorized
    })
  )
  .middleware(Authentication)

const OrgPath = Schema.Struct({ orgSlug: Slug })

const OrgGroup = HttpApiGroup.make("org")
  .add(
    HttpApiEndpoint.get("myOrgs", "/orgs", {
      success: Schema.Array(Org),
      error: Unauthorized
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug", {
      params: OrgPath,
      success: OrgDetail,
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("softDelete", "/orgs/:orgSlug/soft-delete", {
      params: OrgPath,
      success: OrgDetail,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .add(
    HttpApiEndpoint.post("restore", "/orgs/:orgSlug/restore", {
      params: OrgPath,
      success: OrgDetail,
      error: [Unauthorized, NotFound, Forbidden, Conflict]
    })
  )
  .middleware(Authentication)
const ProjectPath = Schema.Struct({ orgSlug: Slug, slug: Slug })
const ProjectMemberPath = Schema.Struct({
  orgSlug: Slug,
  slug: Slug,
  userId: Schema.String
})
const PendingProjectMemberPath = Schema.Struct({
  orgSlug: Slug,
  slug: Slug,
  invitationId: Schema.String
})
const TicketPath = Schema.Struct({ orgSlug: Slug, slug: Slug, id: TicketId })
const AttachmentPath = Schema.Struct({
  orgSlug: Slug,
  slug: Slug,
  id: TicketId,
  attachmentId: Schema.String
})
const OrgAttachmentPath = Schema.Struct({
  orgSlug: Slug,
  attachmentId: Schema.String
})
const ProjectTagPath = Schema.Struct({
  orgSlug: Slug,
  slug: Slug,
  name: TagName
})
const TicketCommentPath = Schema.Struct({
  orgSlug: Slug,
  slug: Slug,
  id: TicketId,
  commentId: CommentId
})
const GroupPath = Schema.Struct({
  orgSlug: Slug,
  slug: Slug,
  id: GroupId
})

const ProjectsGroup = HttpApiGroup.make("projects")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects", {
      params: OrgPath,
      success: Schema.Array(Project),
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects", {
      params: OrgPath,
      payload: CreateProjectInput,
      success: Project,
      error: [Unauthorized, NotFound, Conflict]
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/projects/:slug", {
      params: ProjectPath,
      success: ProjectDetail,
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.patch("update", "/orgs/:orgSlug/projects/:slug", {
      params: ProjectPath,
      payload: UpdateProjectInput,
      success: ProjectDetail,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "updateSetup",
      "/orgs/:orgSlug/projects/:slug/setup",
      {
        params: ProjectPath,
        payload: UpdateProjectSetupInput,
        success: ProjectDetail,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete("delete", "/orgs/:orgSlug/projects/:slug", {
      params: ProjectPath,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .add(
    HttpApiEndpoint.get(
      "githubIntegration",
      "/orgs/:orgSlug/integrations/github",
      {
        params: OrgPath,
        success: GithubOrgIntegrationStatus,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "startGithubInstall",
      "/orgs/:orgSlug/integrations/github/install/start",
      {
        params: OrgPath,
        payload: StartGithubInstallInput,
        success: StartGithubInstallResponse,
        error: [Unauthorized, NotFound, Forbidden, GitHubError]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "listGithubInstallationRepos",
      "/orgs/:orgSlug/integrations/github/repos",
      {
        params: OrgPath,
        query: Schema.Struct({
          q: Schema.optional(Schema.String),
          page: Schema.optional(
            Schema.FiniteFromString.pipe(
              Schema.check(Schema.isInt()),
              Schema.check(Schema.isGreaterThan(0))
            )
          )
        }),
        success: GithubRepoPage,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          RepoGone,
          RateLimited,
          GitHubError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post("addMember", "/orgs/:orgSlug/projects/:slug/members", {
      params: ProjectPath,
      payload: AddMemberInput,
      success: ProjectDetail,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "updateMember",
      "/orgs/:orgSlug/projects/:slug/members/:userId",
      {
        params: ProjectMemberPath,
        payload: UpdateMemberInput,
        success: ProjectDetail,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "transferOwnership",
      "/orgs/:orgSlug/projects/:slug/ownership",
      {
        params: ProjectPath,
        payload: TransferOwnershipInput,
        success: ProjectDetail,
        error: [Unauthorized, NotFound, Forbidden, Validation]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "removeMember",
      "/orgs/:orgSlug/projects/:slug/members/:userId",
      {
        params: ProjectMemberPath,
        success: ProjectDetail,
        error: [Unauthorized, NotFound, Forbidden, ProjectOwnerRemovalBlocked]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "cancelPendingMember",
      "/orgs/:orgSlug/projects/:slug/pending-members/:invitationId",
      {
        params: PendingProjectMemberPath,
        success: ProjectDetail,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "connectGithub",
      "/orgs/:orgSlug/projects/:slug/github",
      {
        params: ProjectPath,
        payload: ConnectGithubInput,
        success: ProjectDetail,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          Conflict,
          GitHubTokenExpired,
          GitHubScopeInsufficient,
          RepoGone,
          RateLimited,
          GitHubError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "disconnectGithub",
      "/orgs/:orgSlug/projects/:slug/github",
      {
        params: ProjectPath,
        success: ProjectDetail,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "gitStates",
      "/orgs/:orgSlug/projects/:slug/git-states",
      {
        params: ProjectPath,
        success: GitStatesResponse,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "listBranches",
      "/orgs/:orgSlug/projects/:slug/github/branches",
      {
        params: ProjectPath,
        query: Schema.Struct({
          q: Schema.optional(Schema.String),
          first: Schema.optional(Schema.FiniteFromString)
        }),
        success: BranchListResponse,
        error: [
          Unauthorized,
          NotFound,
          GitHubTokenExpired,
          GitHubScopeInsufficient,
          RepoGone,
          RateLimited,
          GitHubError
        ]
      }
    )
  )
  .middleware(Authentication)

const EverhourGroup = HttpApiGroup.make("everhour")
  .add(
    HttpApiEndpoint.get("profile", "/integrations/everhour/profile", {
      success: PersonalEverhour,
      error: Unauthorized
    })
  )
  .add(
    HttpApiEndpoint.put("connectProfile", "/integrations/everhour/profile", {
      payload: ConnectEverhourProfileInput,
      success: PersonalEverhour,
      error: [
        Unauthorized,
        EverhourAuthInvalid,
        EverhourRateLimited,
        EverhourConfigMissing,
        EverhourError
      ]
    })
  )
  .add(
    HttpApiEndpoint.delete(
      "disconnectProfile",
      "/integrations/everhour/profile",
      {
        success: PersonalEverhour,
        error: Unauthorized
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "projectStatus",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour",
      {
        params: ProjectPath,
        success: EverhourProjectIntegrationStatus,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "connectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour/connect",
      {
        params: ProjectPath,
        success: EverhourSyncSummary,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          EverhourApiKeyMissing,
          EverhourAuthInvalid,
          EverhourRateLimited,
          EverhourConfigMissing,
          EverhourError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "syncProject",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour/sync",
      {
        params: ProjectPath,
        success: EverhourSyncSummary,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          EverhourApiKeyMissing,
          EverhourAuthInvalid,
          EverhourRateLimited,
          EverhourConfigMissing,
          EverhourError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "disconnectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour",
      {
        params: ProjectPath,
        success: EverhourProjectIntegrationStatus,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "ticketWorkTypes",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/everhour/work-types",
      {
        params: TicketPath,
        success: Schema.Array(WorkTypeOption),
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "startTicketTimer",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/everhour/timer/start",
      {
        params: TicketPath,
        payload: StartTimerInput,
        success: ActiveTimer,
        error: [
          Unauthorized,
          NotFound,
          EverhourApiKeyMissing,
          EverhourAuthInvalid,
          EverhourRateLimited,
          EverhourConfigMissing,
          EverhourError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "startSprintTimer",
      "/orgs/:orgSlug/projects/:slug/groups/:id/everhour/timer/start",
      {
        params: GroupPath,
        payload: StartSprintTimerInput,
        success: ActiveTimer,
        error: [
          Unauthorized,
          NotFound,
          EverhourApiKeyMissing,
          EverhourAuthInvalid,
          EverhourRateLimited,
          EverhourConfigMissing,
          EverhourError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post("stopTimer", "/orgs/:orgSlug/everhour/timer/stop", {
      params: OrgPath,
      success: Schema.NullOr(ActiveTimer),
      error: [
        Unauthorized,
        NotFound,
        EverhourApiKeyMissing,
        EverhourAuthInvalid,
        EverhourRateLimited,
        EverhourConfigMissing,
        EverhourError
      ]
    })
  )
  .add(
    HttpApiEndpoint.get(
      "currentTimer",
      "/orgs/:orgSlug/everhour/timer/current",
      {
        params: OrgPath,
        success: Schema.NullOr(ActiveTimer),
        error: [
          Unauthorized,
          NotFound,
          EverhourApiKeyMissing,
          EverhourAuthInvalid,
          EverhourRateLimited,
          EverhourConfigMissing,
          EverhourError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "logTime",
      "/orgs/:orgSlug/projects/:slug/everhour/time",
      {
        params: ProjectPath,
        payload: LogTimeInput,
        success: Schema.NullOr(TicketTimeSummary),
        error: [
          Unauthorized,
          NotFound,
          EverhourApiKeyMissing,
          EverhourAuthInvalid,
          EverhourRateLimited,
          EverhourConfigMissing,
          EverhourError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "ticketTime",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/everhour/time",
      {
        params: TicketPath,
        success: TicketTimeSummary,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .middleware(Authentication)

const FigmaGroup = HttpApiGroup.make("figma")
  .add(
    HttpApiEndpoint.get("profile", "/integrations/figma/profile", {
      success: PersonalFigma,
      error: [Unauthorized]
    })
  )
  .add(
    HttpApiEndpoint.delete("disconnectProfile", "/integrations/figma/profile", {
      success: PersonalFigma,
      error: [Unauthorized]
    })
  )
  .add(
    HttpApiEndpoint.get(
      "projectStatus",
      "/orgs/:orgSlug/projects/:slug/integrations/figma",
      {
        params: ProjectPath,
        success: FigmaProjectIntegrationStatus,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "connectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/figma/connect",
      {
        params: ProjectPath,
        payload: ConnectFigmaProjectInput,
        success: FigmaProjectIntegrationStatus,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          StorageNotConnected,
          FigmaNotConnected,
          FigmaAuthInvalid,
          FigmaRateLimited,
          FigmaError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "disconnectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/figma",
      {
        params: ProjectPath,
        success: FigmaProjectIntegrationStatus,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "ticketLinks",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/figma/links",
      {
        params: TicketPath,
        success: Schema.Array(FigmaLinkMetadata),
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .middleware(Authentication)

const StorageGroup = HttpApiGroup.make("storage")
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/storage", {
      params: OrgPath,
      success: OrgStorageStatus,
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.put("connect", "/orgs/:orgSlug/storage", {
      params: OrgPath,
      payload: ConnectStorageInput,
      success: OrgStorageStatus,
      error: [
        Unauthorized,
        NotFound,
        Forbidden,
        StorageAuthInvalid,
        StorageConfigMissing,
        StorageError
      ]
    })
  )
  .add(
    HttpApiEndpoint.delete("disconnect", "/orgs/:orgSlug/storage", {
      params: OrgPath,
      success: OrgStorageStatus,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .middleware(Authentication)

const AttachmentsGroup = HttpApiGroup.make("attachments")
  .add(
    HttpApiEndpoint.post(
      "prepare",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/attachments/prepare",
      {
        params: TicketPath,
        payload: PrepareAttachmentInput,
        success: PrepareAttachmentResult,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          AttachmentTooLarge,
          AttachmentTypeRejected,
          StorageNotConnected,
          StorageConfigMissing,
          StorageError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "commit",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/attachments/:attachmentId/commit",
      {
        params: AttachmentPath,
        success: Attachment,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          AttachmentNotUploaded,
          AttachmentTooLarge,
          AttachmentTypeRejected,
          StorageNotConnected,
          StorageConfigMissing,
          StorageError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "prepareProject",
      "/orgs/:orgSlug/projects/:slug/attachments/prepare",
      {
        params: ProjectPath,
        payload: PrepareAttachmentInput,
        success: PrepareAttachmentResult,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          AttachmentTooLarge,
          AttachmentTypeRejected,
          StorageNotConnected,
          StorageConfigMissing,
          StorageError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "commitProject",
      "/orgs/:orgSlug/projects/:slug/attachments/:attachmentId/commit",
      {
        params: Schema.Struct({
          ...ProjectPath.fields,
          attachmentId: Schema.String
        }),
        success: Attachment,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          AttachmentNotUploaded,
          AttachmentTooLarge,
          AttachmentTypeRejected,
          StorageNotConnected,
          StorageConfigMissing,
          StorageError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/attachments", {
      params: OrgPath,
      query: AttachmentListParams,
      success: AttachmentListPage,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .add(
    HttpApiEndpoint.get("summary", "/orgs/:orgSlug/attachments/summary", {
      params: OrgPath,
      success: AttachmentSummary,
      error: [Unauthorized, NotFound, Forbidden]
    })
  )
  .add(
    HttpApiEndpoint.delete(
      "remove",
      "/orgs/:orgSlug/attachments/:attachmentId",
      {
        params: OrgAttachmentPath,
        success: HttpApiSchema.NoContent,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          StorageNotConnected,
          StorageConfigMissing,
          StorageError
        ]
      }
    )
  )
  .middleware(Authentication)

const TicketSearchParams = Schema.Struct({
  q: Schema.optional(Schema.String),
  excludeGroupId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String)
})

const TicketsGroup = HttpApiGroup.make("tickets")
  .add(
    HttpApiEndpoint.get(
      "sections",
      "/orgs/:orgSlug/projects/:slug/tickets/sections",
      {
        params: ProjectPath,
        query: TicketListParams,
        success: TicketSections,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/tickets", {
      params: ProjectPath,
      query: TicketListParams,
      success: TicketListPage,
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get(
      "search",
      "/orgs/:orgSlug/projects/:slug/tickets/search",
      {
        params: ProjectPath,
        query: TicketSearchParams,
        success: Schema.Array(Ticket),
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "count",
      "/orgs/:orgSlug/projects/:slug/tickets/count",
      {
        params: ProjectPath,
        query: TicketCountParams,
        success: TicketCounts,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "quickCreate",
      "/orgs/:orgSlug/projects/:slug/tickets/quick",
      {
        params: ProjectPath,
        payload: QuickCreateTicketInput,
        success: TicketDetail,
        error: [Unauthorized, NotFound, Validation]
      }
    )
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/tickets", {
      params: ProjectPath,
      payload: CreateTicketInput,
      success: TicketDetail,
      error: [Unauthorized, NotFound, Validation, MentionInvalid]
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/projects/:slug/tickets/:id", {
      params: TicketPath,
      success: TicketDetail,
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/tickets/:id",
      {
        params: TicketPath,
        payload: UpdateTicketInput,
        success: TicketDetail,
        error: [Unauthorized, NotFound, Validation, MentionInvalid]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "delete",
      "/orgs/:orgSlug/projects/:slug/tickets/:id",
      {
        params: TicketPath,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "archive",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/archive",
      {
        params: TicketPath,
        payload: ArchiveTicketInput,
        success: TicketDetail,
        error: [Unauthorized, NotFound, Validation, MentionInvalid]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "unarchive",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/unarchive",
      {
        params: TicketPath,
        success: TicketDetail,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "createBranch",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/branch",
      {
        params: TicketPath,
        payload: CreateBranchInput,
        success: TicketDetail,
        error: [
          Unauthorized,
          NotFound,
          Conflict,
          BranchExists,
          BranchProtected,
          GitHubTokenExpired,
          GitHubScopeInsufficient,
          RepoGone,
          RateLimited,
          GitHubError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "openPr",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/pr",
      {
        params: TicketPath,
        payload: OpenPrInput,
        success: OpenPrResult,
        error: [
          Unauthorized,
          NotFound,
          Conflict,
          BranchProtected,
          GitHubTokenExpired,
          GitHubScopeInsufficient,
          RepoGone,
          RateLimited,
          GitHubError
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "clearBranch",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/branch",
      {
        params: TicketPath,
        success: TicketDetail,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "attachBranch",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/attach-branch",
      {
        params: TicketPath,
        payload: AttachBranchInput,
        success: TicketDetail,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          Conflict,
          BranchNotFound,
          GitHubTokenExpired,
          GitHubScopeInsufficient,
          RepoGone,
          RateLimited,
          GitHubError
        ]
      }
    )
  )
  .middleware(Authentication)

const TicketCommentsGroup = HttpApiGroup.make("ticketComments")
  .add(
    HttpApiEndpoint.get(
      "list",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments",
      {
        params: TicketPath,
        success: Schema.Array(Comment),
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "create",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments",
      {
        params: TicketPath,
        payload: CreateCommentInput,
        success: Comment,
        error: [Unauthorized, NotFound, Validation, MentionInvalid]
      }
    )
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments/:commentId",
      {
        params: TicketCommentPath,
        payload: UpdateCommentInput,
        success: Comment,
        error: [Unauthorized, NotFound, Forbidden, Validation, MentionInvalid]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "delete",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments/:commentId",
      {
        params: TicketCommentPath,
        success: HttpApiSchema.NoContent,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .middleware(Authentication)

const TagUsageCounts = Schema.Record(TagName, Schema.Finite)
export type TagUsageCounts = typeof TagUsageCounts.Type

const TagsGroup = HttpApiGroup.make("tags")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/tags", {
      params: ProjectPath,
      success: Schema.Array(Tag),
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get(
      "usageCounts",
      "/orgs/:orgSlug/projects/:slug/tags/usage-counts",
      {
        params: ProjectPath,
        success: TagUsageCounts,
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/tags", {
      params: ProjectPath,
      payload: CreateTagInput,
      success: Tag,
      error: [Unauthorized, NotFound, Forbidden, Conflict]
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/tags/:name",
      {
        params: ProjectTagPath,
        payload: UpdateTagInput,
        success: Tag,
        error: [Unauthorized, NotFound, Forbidden, Conflict]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "delete",
      "/orgs/:orgSlug/projects/:slug/tags/:name",
      {
        params: ProjectTagPath,
        success: HttpApiSchema.NoContent,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .middleware(Authentication)

const ProjectStatusPath = Schema.Struct({
  ...ProjectPath.fields,
  statusSlug: StatusSlug
})

const StatusesGroup = HttpApiGroup.make("statuses")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/statuses", {
      params: ProjectPath,
      success: Schema.Array(ProjectStatus),
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/statuses", {
      params: ProjectPath,
      payload: CreateStatusInput,
      success: ProjectStatus,
      error: [Unauthorized, NotFound, Forbidden, Conflict]
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/statuses/:statusSlug",
      {
        params: ProjectStatusPath,
        payload: UpdateStatusInput,
        success: ProjectStatus,
        error: [Unauthorized, NotFound, Forbidden, Conflict]
      }
    )
  )
  .add(
    HttpApiEndpoint.patch(
      "reorder",
      "/orgs/:orgSlug/projects/:slug/statuses/:statusSlug/order",
      {
        params: ProjectStatusPath,
        payload: ReorderStatusInput,
        success: ProjectStatus,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "remove",
      "/orgs/:orgSlug/projects/:slug/statuses/:statusSlug",
      {
        params: ProjectStatusPath,
        query: Schema.Struct({ reassignTo: Schema.optional(StatusSlug) }),
        success: HttpApiSchema.NoContent,
        error: [Unauthorized, NotFound, Forbidden, Conflict]
      }
    )
  )
  .middleware(Authentication)

const GroupsGroup = HttpApiGroup.make("groups")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/groups", {
      params: ProjectPath,
      success: Schema.Array(Group),
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/groups", {
      params: ProjectPath,
      payload: CreateGroupInput,
      success: Group,
      error: [Unauthorized, NotFound, Forbidden, Validation]
    })
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/projects/:slug/groups/:id", {
      params: GroupPath,
      success: GroupDetail,
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.get(
      "listTickets",
      "/orgs/:orgSlug/projects/:slug/groups/:id/tickets",
      {
        params: GroupPath,
        success: Schema.Array(Ticket),
        error: [Unauthorized, NotFound]
      }
    )
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/groups/:id",
      {
        params: GroupPath,
        payload: UpdateGroupInput,
        success: GroupDetail,
        error: [Unauthorized, NotFound, Forbidden, Validation]
      }
    )
  )
  .add(
    HttpApiEndpoint.patch(
      "updateTickets",
      "/orgs/:orgSlug/projects/:slug/groups/:id/tickets",
      {
        params: GroupPath,
        payload: UpdateGroupTicketsInput,
        success: UpdateGroupTicketsOutput,
        error: [Unauthorized, NotFound, Forbidden, SprintCompletedImmutable]
      }
    )
  )
  .add(
    HttpApiEndpoint.patch(
      "updateTicketOrder",
      "/orgs/:orgSlug/projects/:slug/groups/:id/ticket-order",
      {
        params: GroupPath,
        payload: UpdateTicketOrderInput,
        success: GroupDetail,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          SprintCompletedImmutable,
          Validation
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "complete",
      "/orgs/:orgSlug/projects/:slug/groups/:id/complete",
      {
        params: GroupPath,
        payload: CompleteSprintInput,
        success: GroupDetail,
        error: [
          Unauthorized,
          NotFound,
          Forbidden,
          SprintCompletedImmutable,
          Validation
        ]
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "delete",
      "/orgs/:orgSlug/projects/:slug/groups/:id",
      {
        params: GroupPath,
        success: HttpApiSchema.NoContent,
        error: [Unauthorized, NotFound, Forbidden]
      }
    )
  )
  .middleware(Authentication)

const OAuthApplicationsGroup = HttpApiGroup.make("oauthApplications")
  .add(
    HttpApiEndpoint.get("list", "/oauth-applications", {
      success: Schema.Array(OAuthApplication),
      error: Unauthorized
    })
  )
  .add(
    HttpApiEndpoint.delete("revoke", "/oauth-applications/:id", {
      params: Schema.Struct({ id: Schema.String }),
      success: Schema.Struct({ ok: Schema.Literal(true) }),
      error: [Unauthorized, NotFound]
    })
  )
  .add(
    HttpApiEndpoint.post("consent", "/oauth-applications/consent", {
      payload: Schema.Struct({
        accept: Schema.Boolean,
        oauth_query: Schema.String
      }),
      success: Schema.Struct({ redirectURI: Schema.String }),
      error: [Unauthorized, Validation]
    })
  )
  .middleware(Authentication)

const AppApi = HttpApi.make("projectproject")
  .add(HealthGroup)
  .add(DbGroup)
  .add(AuthGroup)
  .add(OrgGroup)
  .add(ProjectsGroup)
  .add(EverhourGroup)
  .add(FigmaGroup)
  .add(StorageGroup)
  .add(AttachmentsGroup)
  .add(TicketsGroup)
  .add(TicketCommentsGroup)
  .add(TagsGroup)
  .add(StatusesGroup)
  .add(GroupsGroup)
  .add(OAuthApplicationsGroup)
  .annotateMerge(OpenApi.annotations({ servers: [{ url: "/api" }] }))
export { AppApi }

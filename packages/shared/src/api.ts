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
  OpenApi
} from "@effect/platform"
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
import { TicketCounts, TicketListPage } from "./filters/Ticket"
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
  HttpApiEndpoint.get("get", "/health").addSuccess(HealthResponse)
)

const DbPingResponse = Schema.Struct({
  projectCount: Schema.Number
})
export type DbPingResponse = typeof DbPingResponse.Type

const DbGroup = HttpApiGroup.make("db").add(
  HttpApiEndpoint.get("ping", "/db/ping").addSuccess(DbPingResponse)
)

const AuthGroup = HttpApiGroup.make("auth")
  .add(HttpApiEndpoint.get("me", "/me").addSuccess(User).addError(Unauthorized))
  .middleware(Authentication)

const OrgPath = Schema.Struct({ orgSlug: Slug })

const OrgGroup = HttpApiGroup.make("org")
  .add(
    HttpApiEndpoint.get("myOrgs", "/orgs")
      .addSuccess(Schema.Array(Org))
      .addError(Unauthorized)
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug")
      .setPath(OrgPath)
      .addSuccess(OrgDetail)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("softDelete", "/orgs/:orgSlug/soft-delete")
      .setPath(OrgPath)
      .addSuccess(OrgDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.post("restore", "/orgs/:orgSlug/restore")
      .setPath(OrgPath)
      .addSuccess(OrgDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
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
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects")
      .setPath(OrgPath)
      .addSuccess(Schema.Array(Project))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects")
      .setPath(OrgPath)
      .setPayload(CreateProjectInput)
      .addSuccess(Project)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Conflict)
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/projects/:slug")
      .setPath(ProjectPath)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.patch("update", "/orgs/:orgSlug/projects/:slug")
      .setPath(ProjectPath)
      .setPayload(UpdateProjectInput)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.patch("updateSetup", "/orgs/:orgSlug/projects/:slug/setup")
      .setPath(ProjectPath)
      .setPayload(UpdateProjectSetupInput)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.del("delete", "/orgs/:orgSlug/projects/:slug")
      .setPath(ProjectPath)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.get(
      "githubIntegration",
      "/orgs/:orgSlug/integrations/github"
    )
      .setPath(OrgPath)
      .addSuccess(GithubOrgIntegrationStatus)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "startGithubInstall",
      "/orgs/:orgSlug/integrations/github/install/start"
    )
      .setPath(OrgPath)
      .setPayload(StartGithubInstallInput)
      .addSuccess(StartGithubInstallResponse)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(GitHubError)
  )
  .add(
    HttpApiEndpoint.get(
      "listGithubInstallationRepos",
      "/orgs/:orgSlug/integrations/github/repos"
    )
      .setPath(OrgPath)
      .setUrlParams(
        Schema.Struct({
          q: Schema.optional(Schema.String),
          page: Schema.optional(
            Schema.NumberFromString.pipe(Schema.int(), Schema.positive())
          )
        })
      )
      .addSuccess(GithubRepoPage)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(RepoGone)
      .addError(RateLimited)
      .addError(GitHubError)
  )
  .add(
    HttpApiEndpoint.post("addMember", "/orgs/:orgSlug/projects/:slug/members")
      .setPath(ProjectPath)
      .setPayload(AddMemberInput)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.patch(
      "updateMember",
      "/orgs/:orgSlug/projects/:slug/members/:userId"
    )
      .setPath(ProjectMemberPath)
      .setPayload(UpdateMemberInput)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.post(
      "transferOwnership",
      "/orgs/:orgSlug/projects/:slug/ownership"
    )
      .setPath(ProjectPath)
      .setPayload(TransferOwnershipInput)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Validation)
  )
  .add(
    HttpApiEndpoint.del(
      "removeMember",
      "/orgs/:orgSlug/projects/:slug/members/:userId"
    )
      .setPath(ProjectMemberPath)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(ProjectOwnerRemovalBlocked)
  )
  .add(
    HttpApiEndpoint.del(
      "cancelPendingMember",
      "/orgs/:orgSlug/projects/:slug/pending-members/:invitationId"
    )
      .setPath(PendingProjectMemberPath)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.post(
      "connectGithub",
      "/orgs/:orgSlug/projects/:slug/github"
    )
      .setPath(ProjectPath)
      .setPayload(ConnectGithubInput)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
      .addError(GitHubTokenExpired)
      .addError(GitHubScopeInsufficient)
      .addError(RepoGone)
      .addError(GitHubError)
  )
  .add(
    HttpApiEndpoint.del(
      "disconnectGithub",
      "/orgs/:orgSlug/projects/:slug/github"
    )
      .setPath(ProjectPath)
      .addSuccess(ProjectDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.get("gitStates", "/orgs/:orgSlug/projects/:slug/git-states")
      .setPath(ProjectPath)
      .addSuccess(GitStatesResponse)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get(
      "listBranches",
      "/orgs/:orgSlug/projects/:slug/github/branches"
    )
      .setPath(ProjectPath)
      .setUrlParams(
        Schema.Struct({
          q: Schema.optional(Schema.String),
          first: Schema.optional(Schema.NumberFromString)
        })
      )
      .addSuccess(BranchListResponse)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(GitHubTokenExpired)
      .addError(GitHubScopeInsufficient)
      .addError(RepoGone)
      .addError(RateLimited)
      .addError(GitHubError)
  )
  .middleware(Authentication)

const EverhourGroup = HttpApiGroup.make("everhour")
  .add(
    HttpApiEndpoint.get("profile", "/integrations/everhour/profile")
      .addSuccess(PersonalEverhour)
      .addError(Unauthorized)
  )
  .add(
    HttpApiEndpoint.put("connectProfile", "/integrations/everhour/profile")
      .setPayload(ConnectEverhourProfileInput)
      .addSuccess(PersonalEverhour)
      .addError(Unauthorized)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.del("disconnectProfile", "/integrations/everhour/profile")
      .addSuccess(PersonalEverhour)
      .addError(Unauthorized)
  )
  .add(
    HttpApiEndpoint.get(
      "projectStatus",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour"
    )
      .setPath(ProjectPath)
      .addSuccess(EverhourProjectIntegrationStatus)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "connectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour/connect"
    )
      .setPath(ProjectPath)
      .addSuccess(EverhourSyncSummary)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.post(
      "syncProject",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour/sync"
    )
      .setPath(ProjectPath)
      .addSuccess(EverhourSyncSummary)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.del(
      "disconnectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/everhour"
    )
      .setPath(ProjectPath)
      .addSuccess(EverhourProjectIntegrationStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.get(
      "ticketWorkTypes",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/everhour/work-types"
    )
      .setPath(TicketPath)
      .addSuccess(Schema.Array(WorkTypeOption))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "startTicketTimer",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/everhour/timer/start"
    )
      .setPath(TicketPath)
      .setPayload(StartTimerInput)
      .addSuccess(ActiveTimer)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.post(
      "startSprintTimer",
      "/orgs/:orgSlug/projects/:slug/groups/:id/everhour/timer/start"
    )
      .setPath(GroupPath)
      .setPayload(StartSprintTimerInput)
      .addSuccess(ActiveTimer)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.post("stopTimer", "/orgs/:orgSlug/everhour/timer/stop")
      .setPath(OrgPath)
      .addSuccess(Schema.NullOr(ActiveTimer))
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.get("currentTimer", "/orgs/:orgSlug/everhour/timer/current")
      .setPath(OrgPath)
      .addSuccess(Schema.NullOr(ActiveTimer))
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.post(
      "logTime",
      "/orgs/:orgSlug/projects/:slug/everhour/time"
    )
      .setPath(ProjectPath)
      .setPayload(LogTimeInput)
      .addSuccess(Schema.NullOr(TicketTimeSummary))
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(EverhourApiKeyMissing)
      .addError(EverhourAuthInvalid)
      .addError(EverhourRateLimited)
      .addError(EverhourConfigMissing)
      .addError(EverhourError)
  )
  .add(
    HttpApiEndpoint.get(
      "ticketTime",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/everhour/time"
    )
      .setPath(TicketPath)
      .addSuccess(TicketTimeSummary)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .middleware(Authentication)

const StorageGroup = HttpApiGroup.make("storage")
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/storage")
      .setPath(OrgPath)
      .addSuccess(OrgStorageStatus)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.put("connect", "/orgs/:orgSlug/storage")
      .setPath(OrgPath)
      .setPayload(ConnectStorageInput)
      .addSuccess(OrgStorageStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(StorageAuthInvalid)
      .addError(StorageConfigMissing)
      .addError(StorageError)
  )
  .add(
    HttpApiEndpoint.del("disconnect", "/orgs/:orgSlug/storage")
      .setPath(OrgPath)
      .addSuccess(OrgStorageStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .middleware(Authentication)

const AttachmentsGroup = HttpApiGroup.make("attachments")
  .add(
    HttpApiEndpoint.post(
      "prepare",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/attachments/prepare"
    )
      .setPath(TicketPath)
      .setPayload(PrepareAttachmentInput)
      .addSuccess(PrepareAttachmentResult)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(AttachmentTooLarge)
      .addError(AttachmentTypeRejected)
      .addError(StorageNotConnected)
      .addError(StorageConfigMissing)
      .addError(StorageError)
  )
  .add(
    HttpApiEndpoint.post(
      "commit",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/attachments/:attachmentId/commit"
    )
      .setPath(AttachmentPath)
      .addSuccess(Attachment)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(AttachmentNotUploaded)
      .addError(AttachmentTooLarge)
      .addError(AttachmentTypeRejected)
      .addError(StorageNotConnected)
      .addError(StorageConfigMissing)
      .addError(StorageError)
  )
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/attachments")
      .setPath(OrgPath)
      .setUrlParams(AttachmentListParams)
      .addSuccess(AttachmentListPage)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.get("summary", "/orgs/:orgSlug/attachments/summary")
      .setPath(OrgPath)
      .addSuccess(AttachmentSummary)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.del("remove", "/orgs/:orgSlug/attachments/:attachmentId")
      .setPath(OrgAttachmentPath)
      .addSuccess(Schema.Void)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(StorageNotConnected)
      .addError(StorageConfigMissing)
      .addError(StorageError)
  )
  .middleware(Authentication)

const TicketSearchParams = Schema.Struct({
  q: Schema.optional(Schema.String),
  excludeGroupId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.String)
})

const TicketsGroup = HttpApiGroup.make("tickets")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/tickets")
      .setPath(ProjectPath)
      .setUrlParams(TicketListParams)
      .addSuccess(TicketListPage)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get(
      "search",
      "/orgs/:orgSlug/projects/:slug/tickets/search"
    )
      .setPath(ProjectPath)
      .setUrlParams(TicketSearchParams)
      .addSuccess(Schema.Array(Ticket))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get("count", "/orgs/:orgSlug/projects/:slug/tickets/count")
      .setPath(ProjectPath)
      .setUrlParams(TicketCountParams)
      .addSuccess(TicketCounts)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "quickCreate",
      "/orgs/:orgSlug/projects/:slug/tickets/quick"
    )
      .setPath(ProjectPath)
      .setPayload(QuickCreateTicketInput)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Validation)
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/tickets")
      .setPath(ProjectPath)
      .setPayload(CreateTicketInput)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Validation)
      .addError(MentionInvalid)
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/projects/:slug/tickets/:id")
      .setPath(TicketPath)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.patch("update", "/orgs/:orgSlug/projects/:slug/tickets/:id")
      .setPath(TicketPath)
      .setPayload(UpdateTicketInput)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Validation)
      .addError(MentionInvalid)
  )
  .add(
    HttpApiEndpoint.del("delete", "/orgs/:orgSlug/projects/:slug/tickets/:id")
      .setPath(TicketPath)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "archive",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/archive"
    )
      .setPath(TicketPath)
      .setPayload(ArchiveTicketInput)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Validation)
      .addError(MentionInvalid)
  )
  .add(
    HttpApiEndpoint.post(
      "unarchive",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/unarchive"
    )
      .setPath(TicketPath)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "createBranch",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/branch"
    )
      .setPath(TicketPath)
      .setPayload(CreateBranchInput)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Conflict)
      .addError(BranchExists)
      .addError(BranchProtected)
      .addError(GitHubTokenExpired)
      .addError(GitHubScopeInsufficient)
      .addError(RepoGone)
      .addError(RateLimited)
      .addError(GitHubError)
  )
  .add(
    HttpApiEndpoint.post(
      "openPr",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/pr"
    )
      .setPath(TicketPath)
      .setPayload(OpenPrInput)
      .addSuccess(OpenPrResult)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Conflict)
      .addError(BranchProtected)
      .addError(GitHubTokenExpired)
      .addError(GitHubScopeInsufficient)
      .addError(RepoGone)
      .addError(RateLimited)
      .addError(GitHubError)
  )
  .add(
    HttpApiEndpoint.del(
      "clearBranch",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/branch"
    )
      .setPath(TicketPath)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "attachBranch",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/attach-branch"
    )
      .setPath(TicketPath)
      .setPayload(AttachBranchInput)
      .addSuccess(TicketDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
      .addError(BranchNotFound)
      .addError(GitHubTokenExpired)
      .addError(GitHubScopeInsufficient)
      .addError(RepoGone)
      .addError(RateLimited)
      .addError(GitHubError)
  )
  .middleware(Authentication)

const TicketCommentsGroup = HttpApiGroup.make("ticketComments")
  .add(
    HttpApiEndpoint.get(
      "list",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments"
    )
      .setPath(TicketPath)
      .addSuccess(Schema.Array(Comment))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "create",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments"
    )
      .setPath(TicketPath)
      .setPayload(CreateCommentInput)
      .addSuccess(Comment)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Validation)
      .addError(MentionInvalid)
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments/:commentId"
    )
      .setPath(TicketCommentPath)
      .setPayload(UpdateCommentInput)
      .addSuccess(Comment)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Validation)
      .addError(MentionInvalid)
  )
  .add(
    HttpApiEndpoint.del(
      "delete",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/comments/:commentId"
    )
      .setPath(TicketCommentPath)
      .addSuccess(Schema.Void)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .middleware(Authentication)

const TagUsageCounts = Schema.Record({ key: TagName, value: Schema.Number })
export type TagUsageCounts = typeof TagUsageCounts.Type

const TagsGroup = HttpApiGroup.make("tags")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/tags")
      .setPath(ProjectPath)
      .addSuccess(Schema.Array(Tag))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get(
      "usageCounts",
      "/orgs/:orgSlug/projects/:slug/tags/usage-counts"
    )
      .setPath(ProjectPath)
      .addSuccess(TagUsageCounts)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/tags")
      .setPath(ProjectPath)
      .setPayload(CreateTagInput)
      .addSuccess(Tag)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
  )
  .add(
    HttpApiEndpoint.patch("update", "/orgs/:orgSlug/projects/:slug/tags/:name")
      .setPath(ProjectTagPath)
      .setPayload(UpdateTagInput)
      .addSuccess(Tag)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
  )
  .add(
    HttpApiEndpoint.del("delete", "/orgs/:orgSlug/projects/:slug/tags/:name")
      .setPath(ProjectTagPath)
      .addSuccess(Schema.Void)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .middleware(Authentication)

const ProjectStatusPath = Schema.Struct({
  ...ProjectPath.fields,
  statusSlug: StatusSlug
})

const StatusesGroup = HttpApiGroup.make("statuses")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/statuses")
      .setPath(ProjectPath)
      .addSuccess(Schema.Array(ProjectStatus))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/statuses")
      .setPath(ProjectPath)
      .setPayload(CreateStatusInput)
      .addSuccess(ProjectStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
  )
  .add(
    HttpApiEndpoint.patch(
      "update",
      "/orgs/:orgSlug/projects/:slug/statuses/:statusSlug"
    )
      .setPath(ProjectStatusPath)
      .setPayload(UpdateStatusInput)
      .addSuccess(ProjectStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
  )
  .add(
    HttpApiEndpoint.patch(
      "reorder",
      "/orgs/:orgSlug/projects/:slug/statuses/:statusSlug/order"
    )
      .setPath(ProjectStatusPath)
      .setPayload(ReorderStatusInput)
      .addSuccess(ProjectStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.del(
      "remove",
      "/orgs/:orgSlug/projects/:slug/statuses/:statusSlug"
    )
      .setPath(ProjectStatusPath)
      .setUrlParams(Schema.Struct({ reassignTo: Schema.optional(StatusSlug) }))
      .addSuccess(Schema.Void)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Conflict)
  )
  .middleware(Authentication)

const GroupsGroup = HttpApiGroup.make("groups")
  .add(
    HttpApiEndpoint.get("list", "/orgs/:orgSlug/projects/:slug/groups")
      .setPath(ProjectPath)
      .addSuccess(Schema.Array(Group))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("create", "/orgs/:orgSlug/projects/:slug/groups")
      .setPath(ProjectPath)
      .setPayload(CreateGroupInput)
      .addSuccess(Group)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Validation)
  )
  .add(
    HttpApiEndpoint.get("get", "/orgs/:orgSlug/projects/:slug/groups/:id")
      .setPath(GroupPath)
      .addSuccess(GroupDetail)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.get(
      "listTickets",
      "/orgs/:orgSlug/projects/:slug/groups/:id/tickets"
    )
      .setPath(GroupPath)
      .addSuccess(Schema.Array(Ticket))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.patch("update", "/orgs/:orgSlug/projects/:slug/groups/:id")
      .setPath(GroupPath)
      .setPayload(UpdateGroupInput)
      .addSuccess(GroupDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(Validation)
  )
  .add(
    HttpApiEndpoint.patch(
      "updateTickets",
      "/orgs/:orgSlug/projects/:slug/groups/:id/tickets"
    )
      .setPath(GroupPath)
      .setPayload(UpdateGroupTicketsInput)
      .addSuccess(UpdateGroupTicketsOutput)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(SprintCompletedImmutable)
  )
  .add(
    HttpApiEndpoint.patch(
      "updateTicketOrder",
      "/orgs/:orgSlug/projects/:slug/groups/:id/ticket-order"
    )
      .setPath(GroupPath)
      .setPayload(UpdateTicketOrderInput)
      .addSuccess(GroupDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(SprintCompletedImmutable)
      .addError(Validation)
  )
  .add(
    HttpApiEndpoint.post(
      "complete",
      "/orgs/:orgSlug/projects/:slug/groups/:id/complete"
    )
      .setPath(GroupPath)
      .setPayload(CompleteSprintInput)
      .addSuccess(GroupDetail)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(SprintCompletedImmutable)
      .addError(Validation)
  )
  .add(
    HttpApiEndpoint.del("delete", "/orgs/:orgSlug/projects/:slug/groups/:id")
      .setPath(GroupPath)
      .addSuccess(Schema.Void)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .middleware(Authentication)

const OAuthApplicationsGroup = HttpApiGroup.make("oauthApplications")
  .add(
    HttpApiEndpoint.get("list", "/oauth-applications")
      .addSuccess(Schema.Array(OAuthApplication))
      .addError(Unauthorized)
  )
  .add(
    HttpApiEndpoint.del("revoke", "/oauth-applications/:id")
      .setPath(Schema.Struct({ id: Schema.String }))
      .addSuccess(Schema.Struct({ ok: Schema.Literal(true) }))
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post("consent", "/oauth-applications/consent")
      .setPayload(
        Schema.Struct({
          accept: Schema.Boolean,
          consent_code: Schema.String
        })
      )
      .addSuccess(Schema.Struct({ redirectURI: Schema.String }))
      .addError(Unauthorized)
      .addError(Validation)
  )
  .middleware(Authentication)

const AppApi = HttpApi.make("projectproject")
  .add(HealthGroup)
  .add(DbGroup)
  .add(AuthGroup)
  .add(OrgGroup)
  .add(ProjectsGroup)
  .add(EverhourGroup)
  .add(StorageGroup)
  .add(AttachmentsGroup)
  .add(TicketsGroup)
  .add(TicketCommentsGroup)
  .add(TagsGroup)
  .add(StatusesGroup)
  .add(GroupsGroup)
  .add(OAuthApplicationsGroup)
  .annotateContext(OpenApi.annotations({ servers: [{ url: "/api" }] }))
export { AppApi }

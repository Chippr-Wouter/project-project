import * as BunFileSystem from "@effect/platform-bun/BunFileSystem"
import * as BunPath from "@effect/platform-bun/BunPath"
import * as Layer from "effect/Layer"
import { AttachmentUploadsLive } from "./Layers/AttachmentUploads"
import { AttachmentsLive } from "./Layers/Attachments"
import { AuthenticationLive } from "./Layers/Auth"
import { BetterAuthLive } from "./Layers/BetterAuth"
import { CommentsLive } from "./Layers/Comments"
import { CurrentOrgLive } from "./Layers/CurrentOrg"
import { DbLive, PgLive } from "./Layers/Db"
import { EverhourLive } from "./Layers/Everhour"
import { EverhourIntegrationsLive } from "./Layers/EverhourIntegrations"
import { EverhourTimeTrackingLive } from "./Layers/EverhourTimeTracking"
import { GitHubLive } from "./Layers/GitHub"
import { GitHubIntegrationsLive } from "./Layers/GitHubIntegrations"
import { GroupDocsLive } from "./Layers/GroupDocs"
import { GroupsLive } from "./Layers/Groups"
import { MarkdownLive } from "./Layers/Markdown"
import { OAuthApplicationsLive } from "./Layers/OAuthApplications"
import { OrgLive } from "./Layers/Org"
import { OrgStorageLive } from "./Layers/OrgStorage"
import { ProjectDocsLive } from "./Layers/ProjectDocs"
import { ProjectsLive } from "./Layers/Projects"
import { ProjectStatusesLive } from "./Layers/ProjectStatuses"
import { S3StorageLive } from "./Layers/S3Storage"
import { SecretCryptoLive } from "./Layers/SecretCrypto"
import { TagsLive } from "./Layers/Tags"
import { TicketIndexLive } from "./Layers/TicketIndex"
import { TicketDocsLive } from "./Layers/TicketDocs"
import { TicketsLive } from "./Layers/Tickets"
import { UsersLive } from "./Layers/Users"

export const BackendInfrastructureLive = Layer.mergeAll(
  BetterAuthLive,
  DbLive.pipe(Layer.provideMerge(PgLive)),
  BunFileSystem.layer,
  BunPath.layer
)

// @effect-diagnostics-next-line unnecessaryPipeChain:off
export const BackendServicesLive = TagsLive.pipe(
  Layer.provideMerge(ProjectStatusesLive),
  Layer.provideMerge(TicketsLive),
  Layer.provideMerge(AttachmentUploadsLive),
  Layer.provideMerge(AttachmentsLive),
  Layer.provideMerge(CommentsLive),
  Layer.provideMerge(GroupsLive),
  Layer.provideMerge(ProjectsLive),
  Layer.provideMerge(CurrentOrgLive),
  Layer.provideMerge(OrgLive.pipe(Layer.provideMerge(CurrentOrgLive))),
  Layer.provideMerge(GitHubLive),
  Layer.provideMerge(EverhourLive)
)
  .pipe(
    Layer.provideMerge(
      GitHubIntegrationsLive.pipe(
        Layer.provideMerge(CurrentOrgLive),
        Layer.provideMerge(GitHubLive)
      )
    ),
    Layer.provideMerge(
      EverhourIntegrationsLive.pipe(Layer.provideMerge(EverhourLive))
    ),
    Layer.provideMerge(
      EverhourTimeTrackingLive.pipe(Layer.provideMerge(EverhourLive))
    ),
    Layer.provideMerge(UsersLive),
    Layer.provideMerge(TicketIndexLive),
    Layer.provideMerge(ProjectDocsLive),
    Layer.provideMerge(TicketDocsLive),
    Layer.provideMerge(GroupDocsLive),
    Layer.provideMerge(MarkdownLive),
    Layer.provideMerge(OAuthApplicationsLive),
    Layer.provideMerge(SecretCryptoLive)
  )
  .pipe(
    Layer.provideMerge(S3StorageLive),
    Layer.provideMerge(
      OrgStorageLive.pipe(
        Layer.provideMerge(S3StorageLive),
        Layer.provideMerge(SecretCryptoLive),
        Layer.provideMerge(CurrentOrgLive)
      )
    )
  )

export const BackendHttpServicesLive = BackendServicesLive.pipe(
  Layer.provideMerge(AuthenticationLive)
)

export const BackendRuntimeLive = BackendServicesLive.pipe(
  Layer.provide(BackendInfrastructureLive)
)

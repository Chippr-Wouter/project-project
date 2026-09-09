import * as Match from "effect/Match"
import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaFileNotFound,
  FigmaNotConnected,
  FigmaRateLimited
} from "@projectproject/shared"
import type {
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
  RateLimited,
  RepoGone,
  SprintCompletedImmutable,
  StorageAuthInvalid,
  StorageConfigMissing,
  StorageError,
  StorageNotConnected,
  Unauthorized
} from "@projectproject/shared"
import type { InviteAcceptError } from "@/lib/invitations"
import { m } from "@/paraglide/messages"

export type AppError =
  | Unauthorized
  | NotFound
  | Forbidden
  | Conflict
  | EverhourApiKeyMissing
  | EverhourAuthInvalid
  | EverhourConfigMissing
  | EverhourError
  | EverhourRateLimited
  | GitHubTokenExpired
  | GitHubScopeInsufficient
  | RepoGone
  | BranchExists
  | BranchProtected
  | RateLimited
  | GitHubError
  | BranchNotFound
  | MentionInvalid
  | SprintCompletedImmutable
  | InviteAcceptError
  | StorageAuthInvalid
  | StorageConfigMissing
  | StorageError
  | StorageNotConnected
  | AttachmentTooLarge
  | AttachmentTypeRejected
  | AttachmentNotUploaded
  | FigmaNotConnected
  | FigmaAuthInvalid
  | FigmaRateLimited
  | FigmaFileNotFound
  | FigmaError

export const errorMessage = (error: AppError): string =>
  Match.value(error)
    .pipe(
      Match.tag("InviteExpired", () => m.auth_invites_accept_error_expired()),
      Match.tag("InviteNotFound", () =>
        m.auth_invites_accept_error_not_found()
      ),
      Match.tag("InviteNotRecipient", () =>
        m.auth_invites_accept_error_not_recipient()
      ),
      Match.tag("InviteEmailVerificationRequired", () =>
        m.auth_invites_accept_error_email_verification_required()
      ),
      Match.tag("InviteAcceptFailed", () => m.auth_invites_accept_row_error()),
      Match.tag("SprintCompletedImmutable", () =>
        m.error_sprint_completed_immutable()
      ),
      Match.tag("Conflict", (error) =>
        error.reason === "project_key_taken"
          ? m.projects_create_key_taken_error()
          : m.error_unknown()
      ),
      Match.tag("MentionInvalid", () => m.error_mention_invalid()),
      Match.tag("EverhourApiKeyMissing", () =>
        m.error_everhour_api_key_missing()
      ),
      Match.tag("EverhourAuthInvalid", () => m.error_everhour_auth_invalid()),
      Match.tag("EverhourConfigMissing", () =>
        m.error_everhour_config_missing()
      ),
      Match.tag("EverhourRateLimited", (error) =>
        m.error_everhour_rate_limited({
          seconds: String(error.retryAfterSeconds ?? 60)
        })
      ),
      Match.tag("EverhourError", (error) =>
        m.error_everhour_upstream({ message: error.message })
      ),
      Match.tag("RateLimited", () => m.error_github_rate_limited()),
      Match.tag("Unauthorized", () => m.error_unknown())
    )
    .pipe(
      Match.tag("StorageAuthInvalid", () => m.storage_error_auth()),
      Match.tag("StorageConfigMissing", () => m.storage_error_config()),
      Match.tag("StorageError", () => m.storage_error_unreachable()),
      Match.tag("StorageNotConnected", () => m.storage_error_unreachable()),
      Match.tag("AttachmentTooLarge", () => m.editor_attachment_too_large()),
      Match.tag("AttachmentTypeRejected", () =>
        m.editor_attachment_type_rejected()
      ),
      Match.tag("AttachmentNotUploaded", () =>
        m.editor_attachment_upload_failed()
      ),
      Match.tag("FigmaNotConnected", () => m.figma_error_not_connected()),
      Match.tag("FigmaAuthInvalid", () => m.figma_error_auth_invalid()),
      Match.tag("FigmaRateLimited", () => m.figma_error_rate_limited()),
      Match.tag("FigmaFileNotFound", () => m.figma_error_file_not_found()),
      Match.tag("FigmaError", () => m.figma_error_generic()),
      Match.orElse(() => m.error_unknown())
    )

export const figmaStatusErrorMessage = (reason: string): string => {
  const error: AppError = (() => {
    switch (reason) {
      case "figma_not_connected":
        return new FigmaNotConnected()
      case "figma_auth_invalid":
        return new FigmaAuthInvalid()
      case "figma_rate_limited":
        return new FigmaRateLimited({ retryAfterSeconds: 60 })
      case "figma_file_not_found":
        return new FigmaFileNotFound({ fileKey: "" })
      default:
        return new FigmaError({ reason })
    }
  })()
  return errorMessage(error)
}

const conflictReason = (error: unknown): string | null => {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag: unknown })._tag === "Conflict" &&
    "reason" in error &&
    typeof (error as { reason: unknown }).reason === "string"
  ) {
    return (error as { reason: string }).reason
  }
  return null
}

export const statusCreateErrorMessage = (error: unknown): string => {
  switch (conflictReason(error)) {
    case "reserved_slug":
      return m.tickets_status_validation_reserved()
    case "slug_exists":
      return m.tickets_status_validation_slug_exists()
    case "invalid_label":
      return m.tickets_status_validation_invalid_label()
    default:
      return m.tickets_status_create_error_fallback()
  }
}

const tagOf = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    typeof (value as { _tag: unknown })._tag === "string"
  ) {
    return (value as { _tag: string })._tag
  }
  return "Unknown"
}

export const ticketListErrorMessage = (error: unknown): string => {
  const tag = tagOf(error)
  if (tag === "MalformedQuery") return m.tickets_list_malformed_query()
  return m.tickets_list_load_error({ error: tag })
}

export const ticketListDefectMessage = (defect: unknown): string =>
  m.tickets_list_defect({ defect: String(defect) })

export const oauthConsentErrorMessage = (error: unknown): string =>
  Match.value(error).pipe(
    Match.when({ _tag: "Validation", reason: "invalid_signature" }, () =>
      m.auth_oauth_consent_error_invalid_link()
    ),
    Match.when({ _tag: "Unauthorized" }, () =>
      m.auth_oauth_consent_error_session()
    ),
    Match.orElse(() => m.auth_oauth_consent_error_retry())
  )

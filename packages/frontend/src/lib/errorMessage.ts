import * as Match from "effect/Match"
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
      Match.orElse(() => m.error_unknown())
    )

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

import * as Schema from "effect/Schema"

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 }
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  {},
  { httpApiStatus: 404 }
) {}

// 403 — caller is authenticated and the resource exists, but their role
// doesn't permit the action. Distinct from `NotFound` (which we *also* use
// when a non-member hits a project — see Tickets service comment) so that
// existing-but-disallowed actions get a clear signal.
export class Forbidden extends Schema.TaggedError<Forbidden>()(
  "Forbidden",
  {},
  { httpApiStatus: 403 }
) {}

// 409 — request conflicts with current state (e.g. branch already exists, repo
// already connected). Detail in `reason` so the UI can pick the right copy.
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { reason: Schema.String },
  { httpApiStatus: 409 }
) {}

// 400 — caller-supplied input violates a domain invariant the schema can't
// express on its own (cross-field constraints like `endsAt >= startsAt`).
// Use `reason` to disambiguate (`invalid_interval`, ...).
export class Validation extends Schema.TaggedError<Validation>()(
  "Validation",
  { reason: Schema.String },
  { httpApiStatus: 400 }
) {}

// 400 — a `[label](mention:...)` link in a body field failed mention
// validation. Distinct from `Validation` so MCP agents (and the frontend)
// can switch on `kind` and report exactly what's wrong with which href.
// `kind` is one of:
//   - `malformed_href` — the URL doesn't match `mention:user/<id>` or
//     `mention:ticket/<T-N>` (typo, unknown type, missing slash).
//   - `empty_label`    — the link label between `[` and `]` is empty;
//     mentions must always have a visible label.
//   - `unknown_user`   — the user id isn't a member of this project.
//   - `unknown_ticket` — the ticket id doesn't exist in this project.
export const MentionInvalidKind = Schema.Literals([
  "malformed_href",
  "empty_label",
  "unknown_user",
  "unknown_ticket"
])
export type MentionInvalidKind = typeof MentionInvalidKind.Type

export class MentionInvalid extends Schema.TaggedError<MentionInvalid>()(
  "MentionInvalid",
  {
    kind: MentionInvalidKind,
    href: Schema.String
  },
  { httpApiStatus: 400 }
) {}

export class ProjectOwnerRemovalBlocked extends Schema.TaggedError<ProjectOwnerRemovalBlocked>()(
  "ProjectOwnerRemovalBlocked",
  { projectSlugs: Schema.Array(Schema.String) },
  { httpApiStatus: 409 }
) {}

// --- GitHub-side errors -----------------------------------------------------
// Distinct from generic 4xx because the user-facing remedy is different
// (reconnect GitHub vs retry vs nothing). 502 is used for upstream failures
// where the GitHub API misbehaved; 401/403 split tracks token vs scope.

export class GitHubTokenExpired extends Schema.TaggedError<GitHubTokenExpired>()(
  "GitHubTokenExpired",
  {},
  { httpApiStatus: 401 }
) {}

export class GitHubScopeInsufficient extends Schema.TaggedError<GitHubScopeInsufficient>()(
  "GitHubScopeInsufficient",
  {},
  { httpApiStatus: 403 }
) {}

export class RepoGone extends Schema.TaggedError<RepoGone>()(
  "RepoGone",
  {},
  { httpApiStatus: 410 }
) {}

export class BranchExists extends Schema.TaggedError<BranchExists>()(
  "BranchExists",
  { branch: Schema.String },
  { httpApiStatus: 409 }
) {}

export class BranchProtected extends Schema.TaggedError<BranchProtected>()(
  "BranchProtected",
  { branch: Schema.String },
  { httpApiStatus: 422 }
) {}

// Carries the unix-seconds reset timestamp so the UI can show a countdown.
export class RateLimited extends Schema.TaggedError<RateLimited>()(
  "RateLimited",
  { resetAt: Schema.Finite },
  { httpApiStatus: 429 }
) {}

// Catch-all for unexpected GitHub failures. `message` is whatever GitHub
// surfaced — fine to display verbatim, no PII.
export class GitHubError extends Schema.TaggedError<GitHubError>()(
  "GitHubError",
  { message: Schema.String },
  { httpApiStatus: 502 }
) {}

// 404 — caller asked us to attach an existing branch but it isn't on the
// remote (deleted between list and submit, or typo). The UI should refresh
// the branch list and keep the form open.
export class BranchNotFound extends Schema.TaggedError<BranchNotFound>()(
  "BranchNotFound",
  { name: Schema.String },
  { httpApiStatus: 404 }
) {}

export class SprintCompletedImmutable extends Schema.TaggedError<SprintCompletedImmutable>()(
  "SprintCompletedImmutable",
  {},
  { httpApiStatus: 409 }
) {}

export class EverhourApiKeyMissing extends Schema.TaggedError<EverhourApiKeyMissing>()(
  "EverhourApiKeyMissing",
  {},
  { httpApiStatus: 401 }
) {}

export class EverhourAuthInvalid extends Schema.TaggedError<EverhourAuthInvalid>()(
  "EverhourAuthInvalid",
  {},
  { httpApiStatus: 401 }
) {}

export class EverhourRateLimited extends Schema.TaggedError<EverhourRateLimited>()(
  "EverhourRateLimited",
  { retryAfterSeconds: Schema.Finite },
  { httpApiStatus: 429 }
) {}

export class EverhourConfigMissing extends Schema.TaggedError<EverhourConfigMissing>()(
  "EverhourConfigMissing",
  {},
  { httpApiStatus: 503 }
) {}

export class EverhourError extends Schema.TaggedError<EverhourError>()(
  "EverhourError",
  { message: Schema.String },
  { httpApiStatus: 502 }
) {}

export class StorageNotConnected extends Schema.TaggedError<StorageNotConnected>()(
  "StorageNotConnected",
  {},
  { httpApiStatus: 409 }
) {}

export class StorageAuthInvalid extends Schema.TaggedError<StorageAuthInvalid>()(
  "StorageAuthInvalid",
  {},
  { httpApiStatus: 401 }
) {}

export class StorageConfigMissing extends Schema.TaggedError<StorageConfigMissing>()(
  "StorageConfigMissing",
  {},
  { httpApiStatus: 503 }
) {}

export class StorageError extends Schema.TaggedError<StorageError>()(
  "StorageError",
  { reason: Schema.String },
  { httpApiStatus: 502 }
) {}

export class AttachmentTooLarge extends Schema.TaggedError<AttachmentTooLarge>()(
  "AttachmentTooLarge",
  { maxBytes: Schema.Finite },
  { httpApiStatus: 413 }
) {}

export class AttachmentTypeRejected extends Schema.TaggedError<AttachmentTypeRejected>()(
  "AttachmentTypeRejected",
  { contentType: Schema.String },
  { httpApiStatus: 415 }
) {}

export class AttachmentNotUploaded extends Schema.TaggedError<AttachmentNotUploaded>()(
  "AttachmentNotUploaded",
  {},
  { httpApiStatus: 409 }
) {}

export class FigmaNotConnected extends Schema.TaggedError<FigmaNotConnected>()(
  "FigmaNotConnected",
  {},
  HttpApiSchema.annotations({ status: 409 })
) {}

export class FigmaAuthInvalid extends Schema.TaggedError<FigmaAuthInvalid>()(
  "FigmaAuthInvalid",
  {},
  HttpApiSchema.annotations({ status: 401 })
) {}

export class FigmaRateLimited extends Schema.TaggedError<FigmaRateLimited>()(
  "FigmaRateLimited",
  { retryAfterSeconds: Schema.Number },
  HttpApiSchema.annotations({ status: 429 })
) {}

export class FigmaFileNotFound extends Schema.TaggedError<FigmaFileNotFound>()(
  "FigmaFileNotFound",
  { fileKey: Schema.String },
  HttpApiSchema.annotations({ status: 404 })
) {}

export class FigmaError extends Schema.TaggedError<FigmaError>()(
  "FigmaError",
  { reason: Schema.String },
  HttpApiSchema.annotations({ status: 502 })
) {}

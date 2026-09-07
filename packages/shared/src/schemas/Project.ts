// Project schema — over-the-wire shape returned by /projects endpoints.
//
// `slug` is the URL-safe identifier. We constrain it at the schema boundary
// rather than just trusting the server, because the slug is also a filesystem
// path component on disk. A bad slug is a bad path. Lowercase a-z0-9 + dashes
// only, can't start or end with a dash.
//
// `Project` is the full record (used by list responses for now; later by /get).

import * as Schema from "effect/Schema"

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const Slug = Schema.String.pipe(
  Schema.check(Schema.isPattern(SLUG_PATTERN)),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(64))
)
export type Slug = typeof Slug.Type

export const CreatableProjectKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9]{1,9}$/)),
  Schema.brand("CreatableProjectKey")
)
export type CreatableProjectKey = typeof CreatableProjectKey.Type

export const ProjectKey = Schema.Union([
  CreatableProjectKey,
  Schema.Literal("T")
]).pipe(Schema.brand("ProjectKey"))
export type ProjectKey = typeof ProjectKey.Type

// Three-tier role model (spec §"Permission model").
//   owner  — created the project. Sole role with delete + role-change rights.
//   admin  — can manage members; can edit everything.
//   member — read/write tickets and the project body.
export const Role = Schema.Literals(["owner", "admin", "member"])
export type Role = typeof Role.Type

export const ProjectIcon = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(16)),
  Schema.brand("ProjectIcon")
)
export type ProjectIcon = typeof ProjectIcon.Type

export const ProjectColor = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^#[0-9a-f]{6}$/i)),
  Schema.brand("ProjectColor")
)
export type ProjectColor = typeof ProjectColor.Type

// A role assignable through the API. Owner is set on create and transferred
// only via a future "transfer ownership" flow; we don't expose it as a value
// the user can pick from a dropdown.
export const AssignableRole = Schema.Literals(["admin", "member"])
export type AssignableRole = typeof AssignableRole.Type

// Wire shape for a project member. Includes everything the UI needs to
// render and act on a row — `id` is the stable handle for API calls, the
// rest are display fields. `username` and `image` are nullable because
// users created before those fields were populated may not have them yet.
export const Member = Schema.Struct({
  id: Schema.String,
  username: Schema.NullOr(Schema.String),
  name: Schema.String,
  email: Schema.String,
  // GitHub avatar URL, populated by Better Auth on first sign-in. Used by
  // MemberAvatar to render a real photo; if missing or fails to load, the
  // component falls back to a name-initial circle.
  image: Schema.NullOr(Schema.String),
  role: Role
})
export type Member = typeof Member.Type

export const PendingProjectMember = Schema.Struct({
  invitationId: Schema.String,
  email: Schema.String,
  role: AssignableRole,
  expiresAt: Schema.DateFromString
})
export type PendingProjectMember = typeof PendingProjectMember.Type

// GitHub connection on a project. `null` means no repo connected.
// `defaultBaseBranch` overrides the repo's default branch when set.
export const GithubConnection = Schema.Struct({
  repoId: Schema.String,
  repoOwner: Schema.String,
  repoName: Schema.String,
  defaultBaseBranch: Schema.NullOr(Schema.String)
})
export type GithubConnection = typeof GithubConnection.Type

export const GithubOrgIntegrationStatus = Schema.Struct({
  status: Schema.Literals(["not_connected", "active", "broken"]),
  accountLogin: Schema.NullOr(Schema.String),
  accountType: Schema.NullOr(Schema.Literals(["User", "Organization"])),
  lastCheckedAt: Schema.NullOr(Schema.DateFromString),
  lastCheckError: Schema.NullOr(Schema.String)
})
export type GithubOrgIntegrationStatus = typeof GithubOrgIntegrationStatus.Type

export const StartGithubInstallInput = Schema.Struct({
  returnProjectSlug: Schema.optional(Schema.NullOr(Slug))
})
export type StartGithubInstallInput = typeof StartGithubInstallInput.Type

export const StartGithubInstallResponse = Schema.Struct({
  installUrl: Schema.String
})
export type StartGithubInstallResponse = typeof StartGithubInstallResponse.Type

export const ProjectSetup = Schema.Struct({
  workflowReviewedAt: Schema.NullOr(Schema.DateFromString),
  invitePeopleDismissedAt: Schema.NullOr(Schema.DateFromString),
  connectGithubDismissedAt: Schema.NullOr(Schema.DateFromString)
})
export type ProjectSetup = typeof ProjectSetup.Type

export const Project = Schema.Struct({
  org: Slug,
  slug: Slug,
  key: ProjectKey,
  name: Schema.String,
  icon: ProjectIcon,
  color: ProjectColor,
  createdBy: Schema.String,
  createdAt: Schema.DateFromString
})
export type Project = typeof Project.Type

export const CreateProjectInput = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(120))
  ),
  key: CreatableProjectKey
})
export type CreateProjectInput = typeof CreateProjectInput.Type

// Returned by GET /projects/:slug. The list endpoint stays index-shaped (no
// body); this one carries the markdown body so the detail view can render it
// without a second round trip. `members` reflects the frontmatter source of
// truth; `createdBy` is the immutable creator of the project (audit only —
// the owner-role member in `members` is the current owner and may differ).
// `github` is the connection block from project.md; null when no repo is
// connected.
export const ProjectDetail = Schema.Struct({
  ...Project.fields,
  github: Schema.NullOr(GithubConnection),
  setup: ProjectSetup,
  body: Schema.String,
  members: Schema.Array(Member),
  pendingMembers: Schema.Array(PendingProjectMember)
})
export type ProjectDetail = typeof ProjectDetail.Type

export const AddMemberInput = Schema.Struct({
  email: Schema.String.pipe(
    Schema.check(Schema.isMinLength(3)),
    Schema.check(Schema.isMaxLength(254))
  ),
  role: AssignableRole
})
export type AddMemberInput = typeof AddMemberInput.Type

export const UpdateMemberInput = Schema.Struct({
  role: AssignableRole
})
export type UpdateMemberInput = typeof UpdateMemberInput.Type

export const TransferOwnershipInput = Schema.Struct({
  userId: Schema.String
})
export type TransferOwnershipInput = typeof TransferOwnershipInput.Type

// Partial update payload. Both fields optional — the client sends only what
// changed. Empty object is allowed but a no-op on the server.
export const UpdateProjectInput = Schema.Struct({
  name: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(120))
    )
  ),
  body: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIcon),
  color: Schema.optional(ProjectColor)
})
export type UpdateProjectInput = typeof UpdateProjectInput.Type

export const UpdateProjectSetupInput = Schema.Struct({
  workflowReviewedAt: Schema.optional(Schema.NullOr(Schema.DateFromString)),
  invitePeopleDismissedAt: Schema.optional(
    Schema.NullOr(Schema.DateFromString)
  ),
  connectGithubDismissedAt: Schema.optional(
    Schema.NullOr(Schema.DateFromString)
  )
})
export type UpdateProjectSetupInput = typeof UpdateProjectSetupInput.Type

// --- GitHub connection inputs ----------------------------------------------

export const ConnectGithubInput = Schema.Struct({
  repoId: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(80))
  ),
  repoOwner: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(120))
  ),
  repoName: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(120))
  ),
  defaultBaseBranch: Schema.optional(Schema.NullOr(Schema.String))
})
export type ConnectGithubInput = typeof ConnectGithubInput.Type

// What the connect-repo picker renders. `defaultBranch` lets us prefill the
// base-branch picker on first connect, so the user almost never has to pick.
export const GithubRepo = Schema.Struct({
  id: Schema.String,
  owner: Schema.String,
  name: Schema.String,
  defaultBranch: Schema.String,
  private: Schema.Boolean,
  description: Schema.NullOr(Schema.String)
})
export type GithubRepo = typeof GithubRepo.Type

export const GithubRepoPage = Schema.Struct({
  repos: Schema.Array(GithubRepo),
  hasMore: Schema.Boolean
})
export type GithubRepoPage = typeof GithubRepoPage.Type

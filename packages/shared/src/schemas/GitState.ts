import * as Schema from "effect/Schema"
import { StatusSlug } from "./Status"

export const ChecksStatus = Schema.Literals([
  "passing",
  "failing",
  "pending",
  "neutral",
  "none"
])
export type ChecksStatus = typeof ChecksStatus.Type

const NoBranch = Schema.Struct({
  tag: Schema.Literal("no_branch"),
  baseBranch: Schema.optional(Schema.String)
})

const BranchNoPr = Schema.Struct({
  tag: Schema.Literal("branch_no_pr"),
  name: Schema.String,
  baseBranch: Schema.String
})

const BranchPending = Schema.Struct({
  tag: Schema.Literal("branch_pending"),
  name: Schema.String,
  baseBranch: Schema.String,
  pendingOperation: Schema.optional(Schema.Literals(["create", "connect"]))
})

const PrPending = Schema.Struct({
  tag: Schema.Literal("pr_pending"),
  branch: Schema.String,
  baseBranch: Schema.String,
  number: Schema.Finite,
  url: Schema.String
})

const PrOpen = Schema.Struct({
  tag: Schema.Literal("pr_open"),
  branch: Schema.String,
  baseBranch: Schema.String,
  number: Schema.Finite,
  url: Schema.String,
  draft: Schema.Boolean,
  title: Schema.String,
  checks: ChecksStatus
})

const PrMerged = Schema.Struct({
  tag: Schema.Literal("pr_merged"),
  branch: Schema.String,
  baseBranch: Schema.String,
  number: Schema.Finite,
  url: Schema.String,
  title: Schema.String,
  mergedAt: Schema.NullOr(Schema.DateFromString)
})

const PrClosed = Schema.Struct({
  tag: Schema.Literal("pr_closed"),
  branch: Schema.String,
  baseBranch: Schema.String,
  number: Schema.Finite,
  url: Schema.String,
  title: Schema.String
})

const StaleBranch = Schema.Struct({
  tag: Schema.Literal("stale_branch"),
  name: Schema.String
})

export const GitState = Schema.Union([
  NoBranch,
  BranchPending,
  PrPending,
  BranchNoPr,
  PrOpen,
  PrMerged,
  PrClosed,
  StaleBranch
])
export type GitState = typeof GitState.Type

export const GitStateTokenStatus = Schema.Literals([
  "ok",
  "expired",
  "scope_insufficient"
])
export type GitStateTokenStatus = typeof GitStateTokenStatus.Type

export const GitStateRepoStatus = Schema.Literals([
  "ok",
  "gone",
  "not_connected"
])
export type GitStateRepoStatus = typeof GitStateRepoStatus.Type

export const TransitionRecord = Schema.Struct({
  ticketId: Schema.String,
  fromStatus: StatusSlug,
  toStatus: StatusSlug,
  prNumber: Schema.Finite
})
export type TransitionRecord = typeof TransitionRecord.Type

export const GitStatesResponse = Schema.Struct({
  states: Schema.Record(Schema.String, GitState),
  transitioned: Schema.Array(TransitionRecord),
  tokenStatus: GitStateTokenStatus,
  repoStatus: GitStateRepoStatus,
  refreshStatus: Schema.optional(
    Schema.Literals(["fresh", "stale", "rate_limited"])
  ),
  retryAt: Schema.optional(Schema.Finite),
  changedTicketIds: Schema.optional(Schema.Array(Schema.String))
})
export type GitStatesResponse = typeof GitStatesResponse.Type

export const CreateBranchInput = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255))
  ),
  baseBranch: Schema.optional(Schema.String)
})
export type CreateBranchInput = typeof CreateBranchInput.Type

export const OpenPrInput = Schema.Struct({
  title: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(255))
    )
  ),
  body: Schema.optional(Schema.String),
  draft: Schema.optional(Schema.Boolean)
})
export type OpenPrInput = typeof OpenPrInput.Type

export const OpenPrResult = Schema.Struct({
  number: Schema.Finite,
  url: Schema.String
})
export type OpenPrResult = typeof OpenPrResult.Type

export const AttachBranchInput = Schema.Struct({
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(255))
  )
})
export type AttachBranchInput = typeof AttachBranchInput.Type

export const BranchListItem = Schema.Struct({
  name: Schema.String,
  isProtected: Schema.Boolean
})
export type BranchListItem = typeof BranchListItem.Type

export const BranchListResponse = Schema.Struct({
  items: Schema.Array(BranchListItem),
  hasMore: Schema.Boolean
})
export type BranchListResponse = typeof BranchListResponse.Type

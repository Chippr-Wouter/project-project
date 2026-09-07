// Ticket schema — over-the-wire shape returned by /projects/:slug/tickets endpoints.
//
// Tickets are stored as markdown files at
// `<PROJECTS_DIR>/orgs/<org-slug>/projects/<project-slug>/tickets/<ticket-id>.md`.
// The frontmatter is the structured data the API returns; the body is the description.
//

import * as Schema from "effect/Schema"
import { GitState } from "./GitState"
import { ProjectKey } from "./Project"
import { StatusSlug } from "./Status"
import { TagName } from "./Tag"

export const TicketId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9]{0,9}-[1-9][0-9]*$/)),
  Schema.check(
    Schema.makeFilter((id: string) => {
      const dash = id.lastIndexOf("-")
      if (dash < 0) return false
      return Schema.is(ProjectKey)(id.slice(0, dash))
    })
  ),
  Schema.brand("TicketId")
)
export type TicketId = typeof TicketId.Type

export const TicketStatus = StatusSlug
export type TicketStatus = typeof TicketStatus.Type

export function isCarryover(status: TicketStatus): boolean {
  return status !== "done"
}

export const TicketType = Schema.Literals(["feat", "bug", "chore", "other"])
export type TicketType = typeof TicketType.Type

export const TicketPriority = Schema.Literals(["low", "med", "high"])
export type TicketPriority = typeof TicketPriority.Type

export const PullRequestState = Schema.Literals(["open", "closed", "merged"])
export type PullRequestState = typeof PullRequestState.Type

export const Ticket = Schema.Struct({
  id: TicketId,
  title: Schema.String,
  status: TicketStatus,
  type: TicketType,
  priority: TicketPriority,
  tags: Schema.Array(TagName),
  branch: Schema.NullOr(Schema.String),
  // The PR number observed for this ticket's branch. Updated by the server
  // whenever a `git_states` fetch sees a PR for `branch`. Null while the
  // branch has no PR.
  pr: Schema.NullOr(Schema.Finite),
  prState: Schema.NullOr(PullRequestState),
  // Idempotency key for the auto-status transition: set to the PR number we
  // last auto-flipped to `done`. If the user manually moves status back to
  // `in_progress`, we won't reflip because `pr === lastTransitionedPr`.
  lastTransitionedPr: Schema.NullOr(Schema.Finite),
  gitState: GitState,
  assignees: Schema.Array(Schema.String),
  archivedAt: Schema.NullOr(Schema.DateFromString),
  createdBy: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString
})
export type Ticket = typeof Ticket.Type

export const TicketDetail = Schema.Struct({
  ...Ticket.fields,
  body: Schema.String,
  missingAttachments: Schema.optional(Schema.Array(Schema.String))
})
export type TicketDetail = typeof TicketDetail.Type

export const QuickCreateTicketInput = Schema.Struct({
  title: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200))
  ),
  type: Schema.optional(TicketType),
  status: Schema.optional(TicketStatus)
})
export type QuickCreateTicketInput = typeof QuickCreateTicketInput.Type

export const CreateTicketInput = Schema.Struct({
  title: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(200))
  ),
  status: Schema.optional(TicketStatus),
  type: Schema.optional(TicketType),
  priority: Schema.optional(TicketPriority),
  tags: Schema.optional(Schema.Array(TagName)),
  assignees: Schema.optional(Schema.Array(Schema.String)),
  body: Schema.optional(Schema.String)
})
export type CreateTicketInput = typeof CreateTicketInput.Type

export const ArchiveTicketInput = Schema.Struct({
  reason: Schema.optional(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(20_000)))
  )
})
export type ArchiveTicketInput = typeof ArchiveTicketInput.Type

export const UpdateTicketInput = Schema.Struct({
  title: Schema.optional(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(200))
    )
  ),
  status: Schema.optional(TicketStatus),
  type: Schema.optional(TicketType),
  priority: Schema.optional(TicketPriority),
  tags: Schema.optional(Schema.Array(TagName)),
  assignees: Schema.optional(Schema.Array(Schema.String)),
  body: Schema.optional(Schema.String)
})
export type UpdateTicketInput = typeof UpdateTicketInput.Type

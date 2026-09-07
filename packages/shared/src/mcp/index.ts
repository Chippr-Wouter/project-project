import * as Schema from "effect/Schema"
import {
  BranchNotFound,
  Conflict,
  Forbidden,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  MentionInvalid,
  NotFound,
  RateLimited,
  RepoGone,
  SprintCompletedImmutable,
  Unauthorized,
  Validation
} from "../errors"
import { Org } from "../schemas/Org"
import { Member, Project, ProjectDetail, Slug } from "../schemas/Project"
import {
  CompleteSprintInput,
  CreateGroupInput,
  Group,
  GroupDetail,
  GroupId,
  UpdateGroupInput,
  UpdateGroupTicketsOutput
} from "../schemas/Group"
import {
  CreateTicketInput,
  Ticket,
  TicketDetail,
  TicketId,
  UpdateTicketInput
} from "../schemas/Ticket"
import { Tag } from "../schemas/Tag"
import { AttachBranchInput, GitStatesResponse } from "../schemas/GitState"
import { Comment, CreateCommentInput } from "../schemas/Comment"
import { DocFile } from "./DocFile"
import { MeOutput } from "./MeOutput"
import { RebuildTicketIndexOutput } from "./RebuildTicketIndexOutput"
import { Page, Pagination } from "../Pagination"
import { TicketFilter, GroupFilter } from "../filters"
import { SprintState } from "../sprintLogic"

export * from "./DocFile"
export * from "./MeOutput"
export * from "./RebuildTicketIndexOutput"

export interface McpToolSpec<
  Input extends Schema.Top,
  Output extends Schema.Top,
  Errors extends ReadonlyArray<Schema.Top>
> {
  readonly description: string
  readonly input: Input
  readonly output: Output
  readonly errors: Errors
}

export const McpTools = {
  me: {
    description: "Identity of the authed user and their org/project roles.",
    input: Schema.Struct({}),
    output: MeOutput,
    errors: [Unauthorized] as const
  },
  list_orgs: {
    description: "List organizations the caller belongs to.",
    input: Pagination,
    output: Page(Org),
    errors: [Unauthorized] as const
  },
  get_org: {
    description: "Fetch one organization by slug.",
    input: Schema.Struct({ orgSlug: Slug }),
    output: Org,
    errors: [Unauthorized, NotFound] as const
  },
  list_projects: {
    description: "List projects in an org the caller can see.",
    input: Schema.Struct({ orgSlug: Slug, ...Pagination.fields }),
    output: Page(Project),
    errors: [Unauthorized, NotFound] as const
  },
  get_project: {
    description:
      "Fetch one project including github connection, members, and raw markdown body.",
    input: Schema.Struct({ orgSlug: Slug, projectSlug: Slug }),
    output: ProjectDetail,
    errors: [Unauthorized, NotFound] as const
  },
  list_groups: {
    description:
      "List groups (sprints, epics, milestones) in a project, optionally " +
      "filtered by kind or active state. `active` is a sprint-only filter " +
      "(non-sprint groups are excluded when it is set); `active: true` keeps " +
      "sprints that are currently running, `active: false` keeps planned or " +
      "completed sprints.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      filter: Schema.optional(GroupFilter),
      ...Pagination.fields
    }),
    output: Page(Group),
    errors: [Unauthorized, NotFound] as const
  },
  list_sprints: {
    description:
      "List sprints in a project, optionally narrowed to a state. " +
      "`state: 'active'` returns sprints that are currently running; " +
      "'planned' returns future sprints; 'completed' returns past sprints; " +
      "omitted returns all sprints. Uses the same active/planned/completed " +
      "logic as the app's sprint page.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      state: Schema.optional(SprintState),
      ...Pagination.fields
    }),
    output: Page(Group),
    errors: [Unauthorized, NotFound] as const
  },
  get_group: {
    description: "Fetch one group including raw markdown body.",
    input: Schema.Struct({ orgSlug: Slug, projectSlug: Slug, id: GroupId }),
    output: GroupDetail,
    errors: [Unauthorized, NotFound] as const
  },
  list_tickets: {
    description:
      "List tickets in a project with optional server-side filtering.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      filter: Schema.optional(TicketFilter),
      ...Pagination.fields
    }),
    output: Page(Ticket),
    errors: [Unauthorized, NotFound] as const
  },
  get_ticket: {
    description: "Fetch one ticket including raw markdown body.",
    input: Schema.Struct({ orgSlug: Slug, projectSlug: Slug, id: TicketId }),
    output: TicketDetail,
    errors: [Unauthorized, NotFound] as const
  },
  list_tags: {
    description: "List tags defined in a project.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      ...Pagination.fields
    }),
    output: Page(Tag),
    errors: [Unauthorized, NotFound] as const
  },
  list_members: {
    description: "List members of a project with their role.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      ...Pagination.fields
    }),
    output: Page(Member),
    errors: [Unauthorized, NotFound] as const
  },
  get_git_state: {
    description:
      "Fetch git / PR state for a project, optionally narrowed to one ticket.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      ticketId: Schema.optional(TicketId)
    }),
    output: GitStatesResponse,
    errors: [Unauthorized, NotFound] as const
  },
  get_project_doc: {
    description:
      "Raw markdown source of a project's project.md (frontmatter + body).",
    input: Schema.Struct({ orgSlug: Slug, projectSlug: Slug }),
    output: DocFile,
    errors: [Unauthorized, NotFound] as const
  },
  get_group_doc: {
    description:
      "Raw markdown source of a group's .md file (frontmatter + body).",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      id: GroupId
    }),
    output: DocFile,
    errors: [Unauthorized, NotFound] as const
  },
  get_ticket_doc: {
    description:
      "Raw markdown source of a ticket's .md file (frontmatter + body).",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      id: TicketId
    }),
    output: DocFile,
    errors: [Unauthorized, NotFound] as const
  },
  create_ticket: {
    description:
      "Create a new ticket in a project. `title` is required; everything " +
      "else falls back to sensible defaults. `status` is one of " +
      "`todo` | `in_progress` | `done` (default `todo`). `type` is one of " +
      "`feat` | `bug` | `chore` | `other` (default `other`). `priority` is " +
      "one of `low` | `med` | `high` (default `med`). `tags` is an array of " +
      "tag names that must already exist on the project — discover them via " +
      "`list_tags`; the call fails if a name is unknown. `assignees` is an " +
      "array of user ids who must be members of the project — discover them " +
      "via `list_members`. `body` is the ticket description as CommonMark " +
      "markdown; headings, lists, code fences and links are supported. " +
      "Mentions use the exact syntax `[Label](mention:user/<userId>)` for " +
      "people (use a project member's id from `list_members`) and " +
      "`[Label](mention:ticket/<T-N>)` for tickets (use an existing ticket " +
      "id in the same project). Malformed or unknown mentions are rejected " +
      "with `MentionInvalid`. Returns the full ticket including the body.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      ...CreateTicketInput.fields
    }),
    output: TicketDetail,
    errors: [Unauthorized, NotFound, Validation, MentionInvalid] as const
  },
  update_ticket: {
    description:
      "Update an existing ticket. Every field is optional; omitted fields " +
      "are left unchanged. Pass `tags: []` or `assignees: []` to clear the " +
      "list. `status` is one of `todo` | `in_progress` | `done`. `type` is " +
      "one of `feat` | `bug` | `chore` | `other`. `priority` is one of " +
      "`low` | `med` | `high`. `tags` entries must already exist on the " +
      "project; `assignees` entries must be project members. `body` is " +
      "CommonMark markdown and replaces the entire description. Mentions " +
      "use `[Label](mention:user/<userId>)` and " +
      "`[Label](mention:ticket/<T-N>)`; malformed or unknown mentions are " +
      "rejected with `MentionInvalid`. Use `attach_branch` to associate a " +
      "branch — `branch` is not editable through this tool. Returns the " +
      "full ticket after the update.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      id: TicketId,
      ...UpdateTicketInput.fields
    }),
    output: TicketDetail,
    errors: [Unauthorized, NotFound, Validation, MentionInvalid] as const
  },
  create_comment: {
    description:
      "Add a comment to a ticket. `body` is required CommonMark markdown " +
      "(1–20,000 characters). The comment is attributed to the calling user. " +
      "Useful for agents to record what they did on a ticket (e.g. " +
      '"Opened PR #42, ready for review"). Mentions use ' +
      "`[Label](mention:user/<userId>)` for people and " +
      "`[Label](mention:ticket/<T-N>)` for tickets; the user must be a " +
      "project member and the ticket must exist in this project. Malformed " +
      "or unknown mentions are rejected with `MentionInvalid`. Returns the " +
      "created comment.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      ticketId: TicketId,
      ...CreateCommentInput.fields
    }),
    output: Comment,
    errors: [Unauthorized, NotFound, Validation, MentionInvalid] as const
  },
  attach_branch: {
    description:
      "Attach an existing GitHub branch to a ticket. The branch must already " +
      "exist on the project's connected repository — create it first via " +
      "GitHub (your own tooling) and then call this tool with the exact ref " +
      "name. The branch is verified against GitHub before the link is " +
      "stored, so attaching a non-existent name fails with `BranchNotFound` " +
      "rather than producing a dangling reference. Returns the updated " +
      "ticket.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      id: TicketId,
      ...AttachBranchInput.fields
    }),
    output: TicketDetail,
    errors: [
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
    ] as const
  },
  create_sprint: {
    description:
      "Create a new sprint in a project. Forces `kind: 'sprint'` internally — " +
      "use of this tool cannot create epics or milestones. `name` is " +
      "required (1–200 chars); `color` is a `#RRGGBB` string; `startsAt` " +
      "and `endsAt` are ISO 8601 dates and may be null; `tickets` is an " +
      "optional list of ticket ids to attach on creation (sprint membership " +
      "is exclusive across sprints, so existing sprint memberships for " +
      "those tickets will be evicted). The sprint's `body` (markdown " +
      "description) is set separately via `update_sprint` after creation. " +
      "Returns the created sprint.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      name: CreateGroupInput.fields.name,
      color: CreateGroupInput.fields.color,
      startsAt: CreateGroupInput.fields.startsAt,
      endsAt: CreateGroupInput.fields.endsAt,
      tickets: CreateGroupInput.fields.tickets
    }),
    output: Group,
    errors: [Unauthorized, NotFound, Forbidden, Validation] as const
  },
  update_sprint: {
    description:
      "Update a sprint's metadata. Targets `kind: 'sprint'` groups only — " +
      "passing the id of an epic or milestone fails with `Validation` " +
      "(`reason: not_a_sprint:<id>`). Every field is optional; omitted " +
      "fields are left unchanged. `name` is 1–200 chars when supplied; " +
      "`body` is CommonMark markdown and replaces the entire description; " +
      "`color` is `#RRGGBB`; `startsAt` and `endsAt` are ISO 8601 dates or " +
      "null. To complete a sprint, use `complete_sprint` (it carries " +
      "destination semantics for carryover); this tool deliberately " +
      "excludes `completedAt`. Returns the updated sprint.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      id: GroupId,
      name: UpdateGroupInput.fields.name,
      body: UpdateGroupInput.fields.body,
      color: UpdateGroupInput.fields.color,
      startsAt: UpdateGroupInput.fields.startsAt,
      endsAt: UpdateGroupInput.fields.endsAt
    }),
    output: GroupDetail,
    errors: [Unauthorized, NotFound, Forbidden, Validation] as const
  },
  complete_sprint: {
    description:
      "Complete a sprint, sending any carryover (non-`done`) tickets to " +
      "the chosen destination. Targets `kind: 'sprint'` groups only — " +
      "passing the id of an epic or milestone fails with `Validation` " +
      "(`reason: not_a_sprint:<id>`). `destination` is either " +
      "`{ kind: 'sprint', groupId: <G-N> }` (move carryover to another " +
      "sprint) or `{ kind: 'backlog' }` (drop carryover off all sprints). " +
      "Already-completed sprints fail with `SprintCompletedImmutable`. " +
      "Returns the now-completed sprint.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      id: GroupId,
      ...CompleteSprintInput.fields
    }),
    output: GroupDetail,
    errors: [
      Unauthorized,
      NotFound,
      Forbidden,
      SprintCompletedImmutable,
      Validation
    ] as const
  },
  rebuild_ticket_index: {
    description:
      "Rebuild the operational ticket index for a project from its markdown " +
      "ticket documents (the source of truth). The index powers ticket " +
      "lists, counts, search, tag usage, and branch/PR routing; it is kept " +
      "in sync on every write and reconciled on backend boot, so this repair " +
      "action is only needed when drift is suspected. The rebuild is " +
      "transactional (the project's rows are replaced atomically) and " +
      "idempotent. Requires an owner or admin role on the project. Returns " +
      "the drift that was detected (ticket ids `missing` from the index, " +
      "`orphaned` rows with no backing document, and `stale` rows whose " +
      "content was out of date), the number of documents `indexed`, the " +
      "number `skipped` because they were unreadable, and whether the index " +
      "was actually `rebuilt`.",
    input: Schema.Struct({ orgSlug: Slug, projectSlug: Slug }),
    output: RebuildTicketIndexOutput,
    errors: [Unauthorized, NotFound, Forbidden] as const
  },
  add_tickets_to_group: {
    description:
      "Add one or more tickets to a group (sprint, epic, or milestone). " +
      "Additive: existing membership is preserved, ids already in the " +
      "group are deduplicated. The most common use is putting a newly " +
      "created ticket on the active sprint — discover the active sprint " +
      "via `list_sprints` with `state: 'active'`, then call this tool " +
      "with its `id`. Sprint membership is exclusive across sprints, so " +
      "if any of the supplied tickets belong to a different sprint they " +
      "are evicted from that sprint and the eviction is reported in the " +
      "`evicted` field of the response. Adding to a completed sprint " +
      "fails with `SprintCompletedImmutable`. Returns the updated group " +
      "and the list of evictions.",
    input: Schema.Struct({
      orgSlug: Slug,
      projectSlug: Slug,
      groupId: GroupId,
      ticketIds: Schema.Array(TicketId)
    }),
    output: UpdateGroupTicketsOutput,
    errors: [
      Unauthorized,
      NotFound,
      Forbidden,
      SprintCompletedImmutable,
      Validation
    ] as const
  }
} as const satisfies Record<string, McpToolSpec<any, any, any>>

export type McpToolName = keyof typeof McpTools

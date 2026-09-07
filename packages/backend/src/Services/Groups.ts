import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  CompleteSprintInput,
  CreateGroupInput,
  CursorPayload,
  Forbidden,
  Group,
  GroupDetail,
  GroupFilter,
  NotFound,
  SprintCompletedImmutable,
  SprintState,
  TicketId,
  UpdateGroupInput,
  UpdateGroupTicketsInput,
  UpdateGroupTicketsOutput,
  UpdateTicketOrderInput,
  Validation
} from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"

export interface GroupsShape {
  readonly list: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ReadonlyArray<Group>, NotFound | MarkdownError>
  readonly listPaged: (
    orgSlug: string,
    userId: string,
    slug: string,
    filter: GroupFilter | undefined,
    cursor: CursorPayload | undefined,
    limit: number
  ) => Effect.Effect<
    { items: ReadonlyArray<Group>; nextCursor: string | null },
    NotFound | MarkdownError
  >
  readonly listSprintsPaged: (
    orgSlug: string,
    userId: string,
    slug: string,
    state: SprintState | undefined,
    cursor: CursorPayload | undefined,
    limit: number
  ) => Effect.Effect<
    { items: ReadonlyArray<Group>; nextCursor: string | null },
    NotFound | MarkdownError
  >
  readonly get: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string
  ) => Effect.Effect<GroupDetail, NotFound | MarkdownError>
  readonly create: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: CreateGroupInput
  ) => Effect.Effect<Group, NotFound | Forbidden | Validation | MarkdownError>
  readonly update: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string,
    input: UpdateGroupInput
  ) => Effect.Effect<
    GroupDetail,
    NotFound | Forbidden | Validation | MarkdownError
  >
  readonly updateTickets: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string,
    input: UpdateGroupTicketsInput
  ) => Effect.Effect<
    UpdateGroupTicketsOutput,
    NotFound | Forbidden | SprintCompletedImmutable | MarkdownError
  >
  readonly addTickets: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string,
    ticketIds: ReadonlyArray<TicketId>
  ) => Effect.Effect<
    UpdateGroupTicketsOutput,
    NotFound | Forbidden | SprintCompletedImmutable | MarkdownError
  >
  readonly updateTicketOrder: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string,
    input: UpdateTicketOrderInput
  ) => Effect.Effect<
    GroupDetail,
    NotFound | Forbidden | SprintCompletedImmutable | Validation | MarkdownError
  >
  readonly complete: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string,
    input: CompleteSprintInput
  ) => Effect.Effect<
    GroupDetail,
    NotFound | Forbidden | SprintCompletedImmutable | Validation | MarkdownError
  >
  readonly remove: (
    orgSlug: string,
    userId: string,
    slug: string,
    id: string
  ) => Effect.Effect<void, NotFound | Forbidden | MarkdownError>
  readonly removeTicketFromAllGroups: (
    orgSlug: string,
    slug: string,
    ticketId: string
  ) => Effect.Effect<void, MarkdownError>
}

export class Groups extends Context.Service<Groups, GroupsShape>()(
  "@projectproject/backend/Services/Groups"
) {}

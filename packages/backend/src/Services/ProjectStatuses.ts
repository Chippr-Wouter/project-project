import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  Conflict,
  CreateStatusInput,
  DeleteStatusInput,
  Forbidden,
  NotFound,
  ProjectStatus,
  ReorderStatusInput,
  UpdateStatusInput
} from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"

export interface ProjectStatusesShape {
  readonly list: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<ReadonlyArray<ProjectStatus>, NotFound>

  readonly create: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: CreateStatusInput
  ) => Effect.Effect<ProjectStatus, NotFound | Forbidden | Conflict>

  readonly update: (
    orgSlug: string,
    userId: string,
    slug: string,
    statusSlug: string,
    input: UpdateStatusInput
  ) => Effect.Effect<
    ProjectStatus,
    NotFound | Forbidden | Conflict | MarkdownError
  >

  readonly reorder: (
    orgSlug: string,
    userId: string,
    slug: string,
    statusSlug: string,
    input: ReorderStatusInput
  ) => Effect.Effect<ProjectStatus, NotFound | Forbidden>

  readonly remove: (
    orgSlug: string,
    userId: string,
    slug: string,
    statusSlug: string,
    input: DeleteStatusInput
  ) => Effect.Effect<void, NotFound | Forbidden | Conflict | MarkdownError>
}

export class ProjectStatuses extends Context.Service<
  ProjectStatuses,
  ProjectStatusesShape
>()("@projectproject/backend/Services/ProjectStatuses") {}

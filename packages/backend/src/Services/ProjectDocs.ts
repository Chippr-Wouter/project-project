import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  GithubConnection,
  NotFound,
  ProjectKey,
  ProjectSetup,
  Role,
  Slug
} from "@projectproject/shared"
import type { MarkdownError } from "./Markdown"

export interface ProjectDocMember {
  readonly username: string
  readonly role: Role
}

export interface ProjectDocument {
  readonly org?: Slug
  readonly slug: Slug
  readonly key?: ProjectKey
  readonly name: string
  readonly icon: string
  readonly color: string
  readonly createdBy?: string
  readonly createdAt: Date
  readonly members: ReadonlyArray<ProjectDocMember>
  readonly github: GithubConnection | null
  readonly setup: ProjectSetup
  readonly body: string
}

export interface ProjectDocumentWrite {
  readonly org: string
  readonly slug: string
  readonly key: ProjectKey
  readonly name: string
  readonly icon: string
  readonly color: string
  readonly createdBy: string
  readonly createdAt: Date
  readonly members: ReadonlyArray<ProjectDocMember>
  readonly github: GithubConnection | null
  readonly setup: ProjectSetup
  readonly body: string
}

export interface ProjectDocsShape {
  readonly read: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<ProjectDocument, NotFound | MarkdownError>
  readonly write: (
    orgSlug: string,
    slug: string,
    document: ProjectDocumentWrite
  ) => Effect.Effect<void, MarkdownError>
  readonly removeDir: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<void, MarkdownError>
  readonly readRaw: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<
    { path: string; content: string },
    NotFound | MarkdownError
  >
}

export class ProjectDocs extends Context.Service<
  ProjectDocs,
  ProjectDocsShape
>()("@projectproject/backend/Services/ProjectDocs") {}

import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import { NotFound } from "@projectproject/shared"

export class MarkdownError extends Data.TaggedError("MarkdownError")<{
  readonly cause: unknown
  readonly message: string
}> {}

export class TicketIdTaken extends Data.TaggedError("TicketIdTaken")<{}> {}

export class GroupIdTaken extends Data.TaggedError("GroupIdTaken")<{}> {}

export interface ParsedMarkdown {
  readonly data: Record<string, unknown>
  readonly body: string
}

export interface TicketParts {
  readonly data: Record<string, unknown>
  readonly description: string
  readonly region: string
}

export interface MarkdownShape {
  readonly root: string
  readonly projectDir: (orgSlug: string, slug: string) => string
  readonly readProjectFile: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<ParsedMarkdown, NotFound | MarkdownError>
  readonly readProjectFileRaw: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<
    { path: string; content: string },
    NotFound | MarkdownError
  >
  readonly writeProjectFile: (
    orgSlug: string,
    slug: string,
    frontmatter: Record<string, unknown>,
    body: string
  ) => Effect.Effect<void, MarkdownError>
  readonly removeProjectDir: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<void, MarkdownError>
  readonly readTicketFile: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<ParsedMarkdown, NotFound | MarkdownError>
  readonly readTicketParts: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<TicketParts, NotFound | MarkdownError>
  readonly readTicketFileRaw: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<
    { path: string; content: string },
    NotFound | MarkdownError
  >
  readonly createTicketFile: (
    orgSlug: string,
    slug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ) => Effect.Effect<void, MarkdownError | TicketIdTaken>
  readonly writeTicketFile: (
    orgSlug: string,
    slug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ) => Effect.Effect<void, MarkdownError>
  readonly writeTicketWithRegion: (
    orgSlug: string,
    slug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    description: string,
    region: string
  ) => Effect.Effect<void, MarkdownError>
  readonly removeTicketFile: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<void, NotFound | MarkdownError>
  readonly listTicketIds: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<ReadonlyArray<string>, MarkdownError>
  readonly readGroupFile: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<ParsedMarkdown, NotFound | MarkdownError>
  readonly readGroupFileRaw: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<
    { path: string; content: string },
    NotFound | MarkdownError
  >
  readonly createGroupFile: (
    orgSlug: string,
    slug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ) => Effect.Effect<void, MarkdownError | GroupIdTaken>
  readonly writeGroupFile: (
    orgSlug: string,
    slug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ) => Effect.Effect<void, MarkdownError>
  readonly writeGroupFileIfExists: (
    orgSlug: string,
    slug: string,
    id: string,
    frontmatter: Record<string, unknown>,
    body: string
  ) => Effect.Effect<void, NotFound | MarkdownError>
  readonly removeGroupFile: (
    orgSlug: string,
    slug: string,
    id: string
  ) => Effect.Effect<void, NotFound | MarkdownError>
  readonly listGroupIds: (
    orgSlug: string,
    slug: string
  ) => Effect.Effect<ReadonlyArray<string>, MarkdownError>
}

export class Markdown extends Context.Tag(
  "@projectproject/backend/Services/Markdown"
)<Markdown, MarkdownShape>() {}

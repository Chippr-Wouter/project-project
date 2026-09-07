import type { Session, User } from "../auth"
import * as Context from "effect/Context"
import * as Data from "effect/Data"
import type * as Effect from "effect/Effect"
import type {
  CursorPayload,
  NotFound,
  Org,
  PersonalEverhour,
  PersonalGithub
} from "@projectproject/shared"

export class BetterAuthError extends Data.TaggedError("BetterAuthError")<{
  readonly cause: unknown
}> {}

// Boundary error: user has no GitHub account row, or the row has no token.
// The Auth service maps this to `GitHubTokenExpired` for the wire.
export class NoGithubToken extends Data.TaggedError("NoGithubToken")<{}> {}

export interface BetterAuthShape {
  readonly handler: (
    request: Request
  ) => Effect.Effect<Response, BetterAuthError>
  readonly getSession: (
    headers: Headers
  ) => Effect.Effect<{ user: User; session: Session } | null, BetterAuthError>
  readonly getGithubAccessToken: (
    userId: string
  ) => Effect.Effect<string, NoGithubToken | BetterAuthError>
  readonly getPersonalGithub: (
    userId: string
  ) => Effect.Effect<PersonalGithub, BetterAuthError>
  readonly getPersonalEverhour: (
    userId: string
  ) => Effect.Effect<PersonalEverhour, BetterAuthError>
  readonly getOrgSlugById: (
    organizationId: string | null | undefined
  ) => Effect.Effect<string | null, BetterAuthError>
  // Org membership list for a user. Returns the org slug + the user's role
  // in that org. Used by the MCP `me` tool to populate `roles`. We hit the
  // `member` + `organization` tables directly rather than going through
  // `auth.api.listOrganizations` because that API is headers-based — here we
  // already have the resolved userId from `CurrentUser`.
  readonly listOrganizations: (
    userId: string
  ) => Effect.Effect<
    ReadonlyArray<{ orgSlug: string; role: "owner" | "admin" | "member" }>,
    BetterAuthError
  >
  readonly listOrganizationsPaged: (
    userId: string,
    cursor: CursorPayload | undefined,
    limit: number
  ) => Effect.Effect<
    { items: ReadonlyArray<Org>; nextCursor: string | null },
    BetterAuthError
  >
  readonly getOrganization: (
    userId: string,
    orgSlug: string
  ) => Effect.Effect<Org, BetterAuthError | NotFound>
  readonly submitConsent: (
    headers: Headers,
    input: { accept: boolean; oauth_query: string }
  ) => Effect.Effect<{ redirectURI: string }, BetterAuthError>
}

export class BetterAuth extends Context.Tag(
  "@projectproject/backend/Services/BetterAuth"
)<BetterAuth, BetterAuthShape>() {}

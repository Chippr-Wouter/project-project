import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { Forbidden, NotFound, type Role } from "@projectproject/shared"

export interface CurrentOrgShape {
  readonly resolve: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<
    { organizationId: string; orgSlug: string; role: Role },
    NotFound
  >
}

export const isOrgAdminRole = (role: Role): boolean =>
  role === "owner" || role === "admin"

export const requireOrgAdmin = (
  currentOrg: CurrentOrgShape,
  orgSlug: string,
  userId: string
): Effect.Effect<
  { organizationId: string; orgSlug: string; role: Role },
  NotFound | Forbidden
> =>
  currentOrg
    .resolve(orgSlug, userId)
    .pipe(
      Effect.flatMap((org) =>
        isOrgAdminRole(org.role)
          ? Effect.succeed(org)
          : Effect.fail(new Forbidden())
      )
    )

export class CurrentOrg extends Context.Tag(
  "@projectproject/backend/Services/CurrentOrg"
)<CurrentOrg, CurrentOrgShape>() {}

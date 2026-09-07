import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { m } from "@/paraglide/messages"
import { hasErrorCode } from "./invitations"

export type OrgActionError = {
  message: string
  projectSlugs?: ReadonlyArray<string>
}

const projectSlugsOf = (error: unknown): ReadonlyArray<string> | undefined => {
  if (
    typeof error === "object" &&
    error !== null &&
    "projectSlugs" in error &&
    Array.isArray((error as { projectSlugs: unknown }).projectSlugs)
  ) {
    return (error as { projectSlugs: string[] }).projectSlugs
  }
  return undefined
}

export const orgActionError = (error: unknown): OrgActionError => {
  if (hasErrorCode(error, "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION")) {
    return { message: m.org_members_error_already_member() }
  }
  if (hasErrorCode(error, "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION")) {
    return { message: m.org_members_error_already_invited() }
  }
  if (hasErrorCode(error, "PROJECT_OWNER_REMOVAL_BLOCKED")) {
    return {
      message: m.org_members_project_owner_removal_blocked(),
      projectSlugs: projectSlugsOf(error)
    }
  }
  if (hasErrorCode(error, "LAST_ORG_OWNER_BLOCKED")) {
    return { message: m.org_members_error_last_owner() }
  }
  if (
    hasErrorCode(error, "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER")
  ) {
    return { message: m.org_members_error_only_owner_leave() }
  }
  if (
    hasErrorCode(error, "YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE")
  ) {
    return { message: m.org_members_error_role_not_allowed() }
  }
  return { message: m.org_members_action_error() }
}

export const orgActionErrorFromExit = <A>(
  exit: Exit.Exit<A, unknown>
): OrgActionError | null => {
  if (!Exit.isFailure(exit)) return null
  const failure = Cause.findErrorOption(exit.cause)
  const raw = Option.isSome(failure) ? failure.value : exit.cause
  const unwrapped =
    typeof raw === "object" && raw !== null && "error" in raw
      ? (raw as { error: unknown }).error
      : raw
  return orgActionError(unwrapped)
}

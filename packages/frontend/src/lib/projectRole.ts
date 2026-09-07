import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { meAtom } from "@/atoms/auth"
import { useProject } from "@/routes/_authed/orgs/$orgSlug/projects/$slug/-context"
import type { Role } from "@projectproject/shared"

export function useProjectRole(): {
  role: Role
  canManageTags: boolean
  isOwner: boolean
  isAdmin: boolean
} {
  const project = useProject()
  const me = useAtomValue(meAtom)
  const role: Role = Result.isSuccess(me)
    ? (project.members.find((member) => member.id === me.value.id)?.role ??
      "member")
    : "member"
  return {
    role,
    canManageTags: role === "owner" || role === "admin",
    isOwner: role === "owner",
    isAdmin: role === "admin"
  }
}

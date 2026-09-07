import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { useState, type FormEvent } from "react"
import { motion } from "motion/react"
import {
  Check,
  Crown,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound
} from "lucide-react"
import {
  cancelPendingMemberAtom,
  addMemberAtom,
  memberKey,
  pendingMemberKey,
  projectKey,
  removeMemberAtom,
  updateMemberAtom
} from "@/atoms/projects"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from "@/components/ui/input-group"
import { Badge, type BadgeTone } from "@/components/ui/badge"
import { MemberAvatar } from "@/components/MemberAvatar"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"
import type {
  AssignableRole,
  Member,
  PendingProjectMember,
  Role
} from "@projectproject/shared"

const ROLE_META: Record<
  Role,
  { label: () => string; icon: typeof Crown; tone: BadgeTone }
> = {
  owner: { label: () => m.members_role_owner(), icon: Crown, tone: "amber" },
  admin: {
    label: () => m.members_role_admin(),
    icon: ShieldCheck,
    tone: "blue"
  },
  member: {
    label: () => m.members_role_member(),
    icon: UserRound,
    tone: "muted"
  }
}
const ASSIGNABLE_ROLES = [
  "admin",
  "member"
] satisfies ReadonlyArray<AssignableRole>

export function MembersSection({
  orgSlug,
  slug,
  members,
  pendingMembers,
  callerRole,
  callerId
}: {
  orgSlug: string
  slug: string
  members: ReadonlyArray<Member>
  pendingMembers: ReadonlyArray<PendingProjectMember>
  callerRole: Role
  callerId: string
}) {
  const canManage = callerRole === "owner" || callerRole === "admin"
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <AddMemberRow
          orgSlug={orgSlug}
          slug={slug}
          callerRole={callerRole}
          onFocusChange={setAdding}
        />
      )}

      <motion.ul
        animate={{ opacity: adding ? 0.35 : 1 }}
        transition={transitions.presence}
        className="divide-y divide-border rounded-xl border border-border bg-background"
      >
        {members.map((member) => (
          <li key={member.id}>
            <MemberRow
              orgSlug={orgSlug}
              slug={slug}
              member={member}
              callerRole={callerRole}
              callerId={callerId}
            />
          </li>
        ))}
        {pendingMembers.map((member) => (
          <li key={member.invitationId}>
            <PendingMemberRow
              orgSlug={orgSlug}
              slug={slug}
              member={member}
              callerRole={callerRole}
            />
          </li>
        ))}
      </motion.ul>
    </div>
  )
}

function AddMemberRow({
  orgSlug,
  slug,
  callerRole,
  onFocusChange
}: {
  orgSlug: string
  slug: string
  callerRole: Role
  onFocusChange?: (focused: boolean) => void
}) {
  const pKey = projectKey(orgSlug, slug)
  const add = useAtomSet(addMemberAtom(pKey), { mode: "promiseExit" })
  const addState = useAtomValue(addMemberAtom(pKey))
  const submitting = addState.waiting
  const error = Result.isFailure(addState)
    ? m.members_add_error_fallback()
    : null
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<AssignableRole>("member")
  const [submitted, setSubmitted] = useState(false)
  const trimmed = email.trim()
  const availableRoles =
    callerRole === "owner"
      ? ASSIGNABLE_ROLES
      : (["member"] satisfies ReadonlyArray<AssignableRole>)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!trimmed || submitting) return
    onFocusChange?.(false)
    setSubmitted(false)
    const exit = await add({ email: trimmed, role })
    if (Exit.isSuccess(exit)) {
      setEmail("")
      setSubmitted(true)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <InputGroup>
        <InputGroupAddon>
          <Plus className="size-4" strokeWidth={1.75} />
        </InputGroupAddon>
        <InputGroupInput
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setSubmitted(false)
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          placeholder={m.members_add_email_placeholder()}
          aria-label={m.members_add_email_aria_label()}
          disabled={submitting}
        />
        <RoleSelect value={role} onChange={setRole} roles={availableRoles} />
        {error && (
          <span className="shrink-0 text-xs text-destructive">{error}</span>
        )}
        {!error && submitted ? (
          <span
            className="shrink-0 text-xs text-muted-foreground"
            role="status"
          >
            {m.members_add_success()}
          </span>
        ) : null}
      </InputGroup>
    </form>
  )
}

function RoleSelect({
  value,
  onChange,
  roles = ASSIGNABLE_ROLES
}: {
  value: AssignableRole
  onChange: (r: AssignableRole) => void
  roles?: ReadonlyArray<AssignableRole>
}) {
  const meta = ROLE_META[value]
  const Icon = meta.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Badge
            tone={meta.tone}
            size="sm"
            className="cursor-pointer hover:bg-accent"
            render={
              <button
                type="button"
                aria-label={m.members_role_select_aria_label({
                  role: meta.label()
                })}
              />
            }
          >
            <Icon strokeWidth={1.75} />
            {meta.label()}
          </Badge>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-32">
        {roles.map((r) => {
          const roleMeta = ROLE_META[r]
          const RIcon = roleMeta.icon
          return (
            <DropdownMenuItem
              key={r}
              onClick={() => onChange(r)}
              className="cursor-pointer"
            >
              <RIcon className="size-4" strokeWidth={1.75} />
              {roleMeta.label()}
              {r === value && (
                <Check className="ml-auto size-3.5 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MemberRow({
  orgSlug,
  slug,
  member,
  callerRole,
  callerId
}: {
  orgSlug: string
  slug: string
  member: Member
  callerRole: Role
  callerId: string
}) {
  const meta = ROLE_META[member.role]
  const Icon = meta.icon
  const isSelf = member.id === callerId
  // Display: name (primary), then `@username` if set, fall back to email.
  // Email shows as the secondary identifier — useful for "remove bob@..".
  return (
    <div className="flex items-center gap-3 pl-3 pr-3 py-2.5">
      <MemberAvatar member={member} size={32} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">
          {member.name}
          {isSelf && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              {m.members_self_indicator()}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.username ? (
            <>
              <span className="font-mono">@{member.username}</span>
              <span className="mx-1.5">·</span>
            </>
          ) : null}
          {member.email}
        </div>
      </div>
      <Badge tone={meta.tone} size="sm">
        <Icon strokeWidth={1.75} />
        {meta.label()}
      </Badge>
      <MemberMenu
        orgSlug={orgSlug}
        slug={slug}
        member={member}
        callerRole={callerRole}
      />
    </div>
  )
}

function PendingMemberRow({
  orgSlug,
  slug,
  member,
  callerRole
}: {
  orgSlug: string
  slug: string
  member: PendingProjectMember
  callerRole: Role
}) {
  const meta = ROLE_META[member.role]
  const Icon = meta.icon
  const initial = member.email.trim().charAt(0).toUpperCase() || "?"

  return (
    <div className="flex items-center gap-3 py-2.5 pr-3 pl-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-border font-mono text-xs text-muted-foreground">
        {initial}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium text-muted-foreground">
          {member.email}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {m.members_pending_detail()}
        </div>
      </div>
      <Badge tone="muted" size="sm">
        {m.members_pending_badge()}
      </Badge>
      <Badge tone={meta.tone} size="sm">
        <Icon strokeWidth={1.75} />
        {meta.label()}
      </Badge>
      <PendingMemberMenu
        orgSlug={orgSlug}
        slug={slug}
        member={member}
        callerRole={callerRole}
      />
    </div>
  )
}

function PendingMemberMenu({
  orgSlug,
  slug,
  member,
  callerRole
}: {
  orgSlug: string
  slug: string
  member: PendingProjectMember
  callerRole: Role
}) {
  const pKey = pendingMemberKey(orgSlug, slug, member.invitationId)
  const cancel = useAtomSet(cancelPendingMemberAtom(pKey), {
    mode: "promiseExit"
  })
  const cancelState = useAtomValue(cancelPendingMemberAtom(pKey))
  const canceling = cancelState.waiting
  const [confirming, setConfirming] = useState(false)
  const canCancel =
    callerRole === "owner" ||
    (callerRole === "admin" && member.role !== "admin")

  if (!canCancel) return <span className="size-8 shrink-0" />

  async function onCancel() {
    await cancel()
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setConfirming(false)
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={m.members_pending_actions_aria_label()}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-52">
        {confirming ? (
          <div className="flex flex-col gap-2 p-1">
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              {m.members_pending_cancel_confirm_prompt({ email: member.email })}
            </p>
            <div className="flex gap-1 px-1 pb-1">
              <button
                type="button"
                disabled={canceling}
                onClick={() => void onCancel()}
                className="flex-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground transition-colors duration-100 hover:bg-destructive/90 active:scale-[0.97] disabled:opacity-50"
              >
                {canceling
                  ? m.members_pending_cancel_in_progress()
                  : m.members_pending_cancel_button()}
              </button>
              <button
                type="button"
                disabled={canceling}
                onClick={() => setConfirming(false)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground active:scale-[0.97]"
              >
                {m.common_cancel_button()}
              </button>
            </div>
          </div>
        ) : (
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => setConfirming(true)}
            className="cursor-pointer text-destructive focus:text-destructive"
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
            {m.members_pending_cancel_button()}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MemberMenu({
  orgSlug,
  slug,
  member,
  callerRole
}: {
  orgSlug: string
  slug: string
  member: Member
  callerRole: Role
}) {
  const mKey = memberKey(orgSlug, slug, member.id)
  const update = useAtomSet(updateMemberAtom(mKey))
  const remove = useAtomSet(removeMemberAtom(mKey), { mode: "promiseExit" })
  const removeState = useAtomValue(removeMemberAtom(mKey))
  const removing = removeState.waiting
  const [confirming, setConfirming] = useState(false)

  // Only owner can change roles. Admins can remove non-admin members.
  // Owner row has no actionable menu — ownership transfer isn't modeled.
  const canChangeRole = callerRole === "owner" && member.role !== "owner"
  const canRemove =
    member.role !== "owner" &&
    (callerRole === "owner" ||
      (callerRole === "admin" && member.role !== "admin"))

  if (!canChangeRole && !canRemove) return <span className="size-8 shrink-0" />

  async function onRemove() {
    await remove()
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setConfirming(false)
      }}
    >
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={m.members_actions_aria_label()}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-52">
        {confirming ? (
          <div className="flex flex-col gap-2 p-1">
            <p className="px-2 pt-1 text-xs text-muted-foreground">
              {m.members_remove_confirm_prompt({ name: member.name })}
            </p>
            <div className="flex gap-1 px-1 pb-1">
              <button
                type="button"
                disabled={removing}
                onClick={() => void onRemove()}
                className="flex-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {removing
                  ? m.members_remove_in_progress()
                  : m.members_remove_button()}
              </button>
              <button
                type="button"
                disabled={removing}
                onClick={() => setConfirming(false)}
                className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {m.common_cancel_button()}
              </button>
            </div>
          </div>
        ) : (
          <>
            {canChangeRole && (
              <>
                {ASSIGNABLE_ROLES.filter((r) => r !== member.role).map((r) => {
                  const meta = ROLE_META[r]
                  const RIcon = meta.icon
                  const makeLabel =
                    r === "admin"
                      ? m.members_make_admin()
                      : m.members_make_member()
                  return (
                    <DropdownMenuItem
                      key={r}
                      onClick={() => update({ role: r })}
                      className="cursor-pointer"
                    >
                      <RIcon className="size-4" strokeWidth={1.75} />
                      {makeLabel}
                    </DropdownMenuItem>
                  )
                })}
              </>
            )}
            {canChangeRole && canRemove && <DropdownMenuSeparator />}
            {canRemove && (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => setConfirming(true)}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
                {m.members_remove_button()}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Exit from "effect/Exit"
import { useState, type FormEvent } from "react"
import { useNavigate } from "@tanstack/react-router"
import { motion } from "motion/react"
import {
  Check,
  Crown,
  LogOut,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Trash2,
  UserRound
} from "lucide-react"
import {
  cancelOrgInvitationAtom,
  inviteOrgMemberAtom,
  leaveOrgAtom,
  orgInvitationKey,
  orgMemberKey,
  removeOrgMemberAtom,
  transferOrgOwnershipAtom,
  updateOrgMemberRoleAtom,
  type OrgInvitation,
  type OrgMember
} from "@/atoms/orgs"
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
import { orgActionErrorFromExit, type OrgActionError } from "@/lib/orgErrors"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"
import type { AssignableRole, OrgRole } from "@projectproject/shared"

const ROLE_META: Record<
  OrgRole,
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

export function OrgMembersSection({
  orgSlug,
  orgName,
  members,
  invitations,
  callerRole,
  callerUserId
}: {
  orgSlug: string
  orgName: string
  members: ReadonlyArray<OrgMember>
  invitations: ReadonlyArray<OrgInvitation>
  callerRole: OrgRole
  callerUserId: string
}) {
  const canManage = callerRole === "owner" || callerRole === "admin"
  const ownerCount = members.filter((member) => member.role === "owner").length
  const callerMemberId =
    members.find((member) => member.userId === callerUserId)?.id ?? ""
  const isLastOwner = callerRole === "owner" && ownerCount <= 1
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <AddMemberRow orgSlug={orgSlug} onFocusChange={setAdding} />
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
              orgName={orgName}
              member={member}
              callerRole={callerRole}
              callerMemberId={callerMemberId}
              isSelf={member.userId === callerUserId}
              ownerCount={ownerCount}
            />
          </li>
        ))}
        {invitations.map((invitation) => (
          <li key={invitation.id}>
            <InvitationRow
              orgSlug={orgSlug}
              invitation={invitation}
              canManage={canManage}
            />
          </li>
        ))}
      </motion.ul>

      {isLastOwner && (
        <p className="text-xs text-muted-foreground">
          {m.org_members_last_owner_note()}
        </p>
      )}
    </div>
  )
}

function AddMemberRow({
  orgSlug,
  onFocusChange
}: {
  orgSlug: string
  onFocusChange?: (focused: boolean) => void
}) {
  const invite = useAtomSet(inviteOrgMemberAtom(orgSlug), {
    mode: "promiseExit"
  })
  const inviteState = useAtomValue(inviteOrgMemberAtom(orgSlug))
  const submitting = inviteState.waiting
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<AssignableRole>("member")
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<OrgActionError | null>(null)
  const trimmed = email.trim()

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!trimmed || submitting) return
    onFocusChange?.(false)
    setSubmitted(false)
    setError(null)
    const exit = await invite({ email: trimmed, role })
    if (Exit.isSuccess(exit)) {
      setEmail("")
      setSubmitted(true)
    } else {
      setError(orgActionErrorFromExit(exit))
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
            setError(null)
          }}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          placeholder={m.org_members_invite_placeholder()}
          aria-label={m.members_add_email_aria_label()}
          disabled={submitting}
        />
        <RoleSelect value={role} onChange={setRole} roles={ASSIGNABLE_ROLES} />
        {error && (
          <span className="shrink-0 text-xs text-destructive">
            {error.message}
          </span>
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
            className="cursor-pointer transition-colors hover:bg-accent"
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
  orgName,
  member,
  callerRole,
  callerMemberId,
  isSelf,
  ownerCount
}: {
  orgSlug: string
  orgName: string
  member: OrgMember
  callerRole: OrgRole
  callerMemberId: string
  isSelf: boolean
  ownerCount: number
}) {
  const meta = ROLE_META[member.role]
  const Icon = meta.icon
  return (
    <div className="flex items-center gap-3 pl-3 pr-3 py-2.5">
      <MemberAvatar member={member} size={32} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">
          {member.name || member.email}
          {isSelf && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              {m.members_self_indicator()}
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {member.email}
        </div>
      </div>
      <Badge tone={meta.tone} size="sm">
        <Icon strokeWidth={1.75} />
        {meta.label()}
      </Badge>
      <MemberMenu
        orgSlug={orgSlug}
        orgName={orgName}
        member={member}
        callerRole={callerRole}
        callerMemberId={callerMemberId}
        isSelf={isSelf}
        ownerCount={ownerCount}
      />
    </div>
  )
}

function InvitationRow({
  orgSlug,
  invitation,
  canManage
}: {
  orgSlug: string
  invitation: OrgInvitation
  canManage: boolean
}) {
  const meta = ROLE_META[invitation.role]
  const Icon = meta.icon
  const initial = invitation.email.trim().charAt(0).toUpperCase() || "?"

  return (
    <div className="flex items-center gap-3 py-2.5 pr-3 pl-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-border font-mono text-xs text-muted-foreground">
        {initial}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium text-muted-foreground">
          {invitation.email}
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
      {canManage ? (
        <InvitationMenu orgSlug={orgSlug} invitation={invitation} />
      ) : (
        <span className="size-8 shrink-0" />
      )}
    </div>
  )
}

function InvitationMenu({
  orgSlug,
  invitation
}: {
  orgSlug: string
  invitation: OrgInvitation
}) {
  const key = orgInvitationKey(orgSlug, invitation.id)
  const cancel = useAtomSet(cancelOrgInvitationAtom(key), {
    mode: "promiseExit"
  })
  const cancelState = useAtomValue(cancelOrgInvitationAtom(key))
  const canceling = cancelState.waiting
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<OrgActionError | null>(null)

  async function onCancelInvite() {
    setError(null)
    const exit = await cancel()
    if (Exit.isSuccess(exit)) {
      setConfirming(false)
    } else {
      setError(orgActionErrorFromExit(exit))
    }
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setConfirming(false)
          setError(null)
        }
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
          <ConfirmBlock
            prompt={m.members_pending_cancel_confirm_prompt({
              email: invitation.email
            })}
            confirmLabel={
              canceling
                ? m.members_pending_cancel_in_progress()
                : m.members_pending_cancel_button()
            }
            busy={canceling}
            error={error}
            onConfirm={() => void onCancelInvite()}
            onCancel={() => setConfirming(false)}
          />
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

type Confirm =
  | { kind: "remove" }
  | { kind: "transfer" }
  | { kind: "leave" }
  | null

function MemberMenu({
  orgSlug,
  orgName,
  member,
  callerRole,
  callerMemberId,
  isSelf,
  ownerCount
}: {
  orgSlug: string
  orgName: string
  member: OrgMember
  callerRole: OrgRole
  callerMemberId: string
  isSelf: boolean
  ownerCount: number
}) {
  const mKey = orgMemberKey(orgSlug, member.id)
  const navigate = useNavigate()
  const update = useAtomSet(updateOrgMemberRoleAtom(mKey), {
    mode: "promiseExit"
  })
  const remove = useAtomSet(removeOrgMemberAtom(mKey), { mode: "promiseExit" })
  const transfer = useAtomSet(transferOrgOwnershipAtom(orgSlug), {
    mode: "promiseExit"
  })
  const leave = useAtomSet(leaveOrgAtom(orgSlug), { mode: "promiseExit" })
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<OrgActionError | null>(null)

  const canManage = callerRole === "owner" || callerRole === "admin"
  const isLastOwner = callerRole === "owner" && ownerCount <= 1
  const canChangeRole = canManage && member.role !== "owner" && !isSelf
  const canTransfer =
    callerRole === "owner" && member.role === "admin" && !isSelf
  const canRemove = canManage && !isSelf && member.role !== "owner"
  const canLeave = isSelf && !isLastOwner

  if (!canChangeRole && !canTransfer && !canRemove && !canLeave) {
    return <span className="size-8 shrink-0" />
  }

  async function onRemove() {
    setBusy(true)
    setError(null)
    const exit = await remove()
    setBusy(false)
    if (Exit.isSuccess(exit)) {
      setConfirm(null)
    } else {
      setError(orgActionErrorFromExit(exit))
    }
  }

  async function onTransfer() {
    setBusy(true)
    setError(null)
    const exit = await transfer({
      toMemberId: member.id,
      selfMemberId: callerMemberId
    })
    setBusy(false)
    if (Exit.isSuccess(exit)) {
      setConfirm(null)
    } else {
      setError(orgActionErrorFromExit(exit))
    }
  }

  async function onLeave() {
    setBusy(true)
    setError(null)
    const exit = await leave()
    setBusy(false)
    if (Exit.isSuccess(exit)) {
      setConfirm(null)
      void navigate({ to: "/" })
    } else {
      setError(orgActionErrorFromExit(exit))
    }
  }

  async function onUpdateRole(role: AssignableRole) {
    setError(null)
    const exit = await update({ role })
    if (Exit.isFailure(exit)) setError(orgActionErrorFromExit(exit))
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) {
          setConfirm(null)
          setError(null)
        }
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
      <DropdownMenuContent align="end" sideOffset={6} className="w-60">
        {confirm?.kind === "remove" ? (
          <ConfirmBlock
            prompt={m.members_remove_confirm_prompt({
              name: member.name || member.email
            })}
            confirmLabel={
              busy ? m.members_remove_in_progress() : m.members_remove_button()
            }
            busy={busy}
            error={error}
            onConfirm={() => void onRemove()}
            onCancel={() => setConfirm(null)}
          />
        ) : confirm?.kind === "transfer" ? (
          <ConfirmBlock
            prompt={m.org_members_transfer_confirm_prompt({
              name: member.name || member.email
            })}
            confirmLabel={
              busy
                ? m.org_members_transfer_in_progress()
                : m.org_members_make_owner()
            }
            busy={busy}
            error={error}
            onConfirm={() => void onTransfer()}
            onCancel={() => setConfirm(null)}
          />
        ) : confirm?.kind === "leave" ? (
          <ConfirmBlock
            prompt={m.org_members_leave_confirm_prompt({ org: orgName })}
            confirmLabel={
              busy
                ? m.org_members_leave_in_progress()
                : m.org_members_leave_button()
            }
            busy={busy}
            error={error}
            onConfirm={() => void onLeave()}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          <>
            {canChangeRole &&
              ASSIGNABLE_ROLES.filter((r) => r !== member.role).map((r) => {
                const meta = ROLE_META[r]
                const RIcon = meta.icon
                const makeLabel =
                  r === "admin"
                    ? m.members_make_admin()
                    : m.members_make_member()
                return (
                  <DropdownMenuItem
                    key={r}
                    onClick={() => void onUpdateRole(r)}
                    className="cursor-pointer"
                  >
                    <RIcon className="size-4" strokeWidth={1.75} />
                    {makeLabel}
                  </DropdownMenuItem>
                )
              })}
            {canTransfer && (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => setConfirm({ kind: "transfer" })}
                className="cursor-pointer"
              >
                <Crown className="size-4" strokeWidth={1.75} />
                {m.org_members_make_owner()}
              </DropdownMenuItem>
            )}
            {(canChangeRole || canTransfer) && (canRemove || canLeave) && (
              <DropdownMenuSeparator />
            )}
            {canRemove && (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => setConfirm({ kind: "remove" })}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
                {m.members_remove_button()}
              </DropdownMenuItem>
            )}
            {canLeave && (
              <DropdownMenuItem
                closeOnClick={false}
                onClick={() => setConfirm({ kind: "leave" })}
                className="cursor-pointer text-destructive focus:text-destructive"
              >
                <LogOut className="size-4" strokeWidth={1.75} />
                {m.org_members_leave_button()}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ConfirmBlock({
  prompt,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel
}: {
  prompt: string
  confirmLabel: string
  busy: boolean
  error: OrgActionError | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex flex-col gap-2 p-1">
      <p className="px-2 pt-1 text-xs text-muted-foreground">{prompt}</p>
      {error && (
        <p className="px-2 text-xs text-destructive">
          {error.message}
          {error.projectSlugs && error.projectSlugs.length > 0 ? (
            <span className="font-mono"> {error.projectSlugs.join(", ")}</span>
          ) : null}
        </p>
      )}
      <div className="flex gap-1 px-1 pb-1">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="flex-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground transition-all duration-100 hover:bg-destructive/90 active:scale-[0.97] disabled:opacity-50"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-all duration-100 hover:bg-accent hover:text-foreground active:scale-[0.97]"
        >
          {m.common_cancel_button()}
        </button>
      </div>
    </div>
  )
}

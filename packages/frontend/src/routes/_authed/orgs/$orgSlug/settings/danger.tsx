import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { useState, type FormEvent } from "react"
import { setActiveOrganizationAtom } from "@/atoms/auth"
import {
  orgDetailAtom,
  orgKey,
  softDeleteOrgAtom,
  userOrgsAtom
} from "@/atoms/orgs"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { nextActiveOrgSlug } from "@/lib/orgReflow"
import { m } from "@/paraglide/messages"
import { ORG_DELETE_GRACE_DAYS, type OrgDetail } from "@projectproject/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/settings/danger")({
  component: DangerSettings,
  loader: () => ({
    crumb: { type: "static" as const, label: m.org_settings_danger_tab() }
  })
})

function DangerSettings() {
  const { orgSlug } = Route.useParams()
  const result = useAtomValue(orgDetailAtom(orgSlug))

  return Result.matchWithError(result, {
    onInitial: () => <DangerSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value }) =>
      value.role === "owner" ? (
        <DeleteCard orgSlug={orgSlug} org={value} />
      ) : (
        <div className="rounded-xl border border-border bg-background p-5 text-sm text-muted-foreground">
          {m.org_danger_owner_only()}
        </div>
      )
  })
}

function DeleteCard({ orgSlug, org }: { orgSlug: string; org: OrgDetail }) {
  const navigate = useNavigate()
  const softDelete = useAtomSet(softDeleteOrgAtom(orgKey(orgSlug)), {
    mode: "promiseExit"
  })
  const deleteState = useAtomValue(softDeleteOrgAtom(orgKey(orgSlug)))
  const setActive = useAtomSet(setActiveOrganizationAtom("me"), {
    mode: "promiseExit"
  })
  const orgsResult = useAtomValue(userOrgsAtom)
  const [confirm, setConfirm] = useState("")

  const submitting = deleteState.waiting
  const error = Result.isFailure(deleteState)
    ? m.org_danger_delete_error()
    : null
  const canDelete = confirm.trim() === org.slug && !submitting

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canDelete) return
    const exit = await softDelete()
    if (!Exit.isSuccess(exit)) return

    const orgs = Result.isSuccess(orgsResult) ? orgsResult.value : []
    const nextSlug = nextActiveOrgSlug(orgs, orgSlug)
    if (nextSlug) {
      await setActive(nextSlug)
      await navigate({ to: "/orgs/$orgSlug", params: { orgSlug: nextSlug } })
    } else {
      await navigate({ to: "/welcome" })
    }
  }

  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border border-destructive/30 bg-destructive/[0.03] p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold tracking-tight text-destructive">
          {m.org_danger_delete_heading()}
        </h2>
        <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
          {m.org_danger_delete_description({ days: ORG_DELETE_GRACE_DAYS })}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label
          htmlFor="org-delete-confirm"
          className="text-sm font-medium text-foreground"
        >
          {m.org_danger_delete_confirm_label({ slug: org.slug })}
        </label>
        <Input
          id="org-delete-confirm"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          disabled={submitting}
          placeholder={org.slug}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="max-w-sm font-mono"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="submit"
          variant="destructive"
          className="w-fit"
          disabled={!canDelete}
        >
          {submitting
            ? m.org_danger_delete_in_progress()
            : m.org_danger_delete_button()}
        </Button>
      </form>
    </div>
  )
}

function DangerSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border border-border p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full max-w-[60ch] animate-pulse rounded bg-muted" />
      <div className="h-8 w-full max-w-sm animate-pulse rounded-md bg-muted" />
      <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
    </div>
  )
}

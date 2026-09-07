import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState, type FormEvent } from "react"
import { orgDetailAtom, orgKey, renameOrgAtom } from "@/atoms/orgs"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { m } from "@/paraglide/messages"

import type { OrgDetail } from "@projectproject/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/settings/general")(
  {
    component: GeneralSettings,
    loader: () => ({
      crumb: { type: "static" as const, label: m.org_settings_general_tab() }
    })
  }
)

function GeneralSettings() {
  const { orgSlug } = Route.useParams()
  const result = useAtomValue(orgDetailAtom(orgSlug))

  return Result.matchWithError(result, {
    onInitial: () => <GeneralSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value }) => <GeneralForm orgSlug={orgSlug} org={value} />
  })
}

function GeneralForm({ orgSlug, org }: { orgSlug: string; org: OrgDetail }) {
  const key = orgKey(orgSlug)
  const rename = useAtomSet(renameOrgAtom(key), { mode: "promiseExit" })
  const renameState = useAtomValue(renameOrgAtom(key))
  const canEdit = org.role === "owner" || org.role === "admin"
  const [name, setName] = useState(org.name)

  useEffect(() => setName(org.name), [org.name])

  const submitting = renameState.waiting
  const error = Result.isFailure(renameState)
    ? m.org_settings_rename_error()
    : null
  const trimmed = name.trim()
  const dirty = trimmed.length > 0 && trimmed !== org.name

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!dirty || !canEdit) return
    await rename({ name: trimmed })
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <form onSubmit={onSubmit} className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="org-name">
          {m.org_settings_name_label()}
        </label>
        <div className="flex gap-2">
          <Input
            id="org-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!canEdit || submitting}
            maxLength={120}
          />
          {canEdit ? (
            <Button
              type="submit"
              variant="secondary"
              disabled={submitting || !dirty}
            >
              {m.org_settings_save_button()}
            </Button>
          ) : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </form>

      <div className="grid gap-2">
        <span className="text-sm font-medium">
          {m.org_settings_slug_label()}
        </span>
        <span className="w-fit rounded-md border border-border bg-background px-2 py-1 font-mono text-sm">
          {org.slug}
        </span>
        <p className="text-sm text-muted-foreground">
          {m.org_settings_slug_readonly_note()}
        </p>
      </div>

      <section className="flex flex-col gap-2 border-t border-border pt-6">
        <h2 className="text-lg font-semibold tracking-tight">
          {m.org_settings_billing_heading()}
        </h2>
        <p className="text-sm text-muted-foreground">
          {m.org_settings_billing_placeholder_note()}
        </p>
      </section>
    </div>
  )
}

function GeneralSkeleton() {
  return (
    <div className="flex w-full flex-col gap-8">
      <div className="grid gap-2">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-8 w-full max-w-md animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-2">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
      </div>
    </div>
  )
}

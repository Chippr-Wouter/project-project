import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useRouter } from "@tanstack/react-router"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { useState } from "react"
import { orgDetailAtom, restoreOrgAtom } from "@/atoms/orgs"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import { DitherShell } from "@/components/ui/dither-shell"
import { getLocale } from "@/paraglide/runtime"
import { m } from "@/paraglide/messages"
import type { OrgDetail } from "@projectproject/shared"

const formatDate = (date: Date): string =>
  new Intl.DateTimeFormat(getLocale(), { dateStyle: "long" }).format(date)

export function DeletedOrgPage({ orgSlug }: { orgSlug: string }) {
  const result = useAtomValue(orgDetailAtom(orgSlug))

  return Result.matchWithError(result, {
    onInitial: () => (
      <DitherShell contained animated>
        {null}
      </DitherShell>
    ),
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value }) => <DeletedBody orgSlug={orgSlug} org={value} />
  })
}

function DeletedBody({ orgSlug, org }: { orgSlug: string; org: OrgDetail }) {
  const router = useRouter()
  const restore = useAtomSet(restoreOrgAtom(orgSlug), { mode: "promiseExit" })
  const restoreState = useAtomValue(restoreOrgAtom(orgSlug))
  const [error, setError] = useState<string | null>(null)

  const restoring = restoreState.waiting
  const isOwner = org.role === "owner"

  async function onRestore() {
    setError(null)
    const exit = await restore()
    if (Exit.isSuccess(exit)) {
      await router.invalidate()
      await router.navigate({ to: "/orgs/$orgSlug", params: { orgSlug } })
      return
    }
    const failure = Cause.findErrorOption(exit.cause)
    const graceExpired =
      Option.isSome(failure) &&
      failure.value._tag === "Conflict" &&
      failure.value.reason === "grace_expired"
    setError(
      graceExpired
        ? m.org_deleted_restore_grace_expired()
        : m.org_deleted_restore_error()
    )
  }

  return (
    <DitherShell contained animated>
      <div className="relative flex max-w-[42ch] flex-col items-center gap-3 px-8 pt-10 text-center">
        <span className="font-mono text-sm text-muted-foreground">
          {org.slug}
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {m.org_deleted_page_title()}
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {org.deletedAt
            ? m.org_deleted_page_body({ date: formatDate(org.deletedAt) })
            : m.org_deleted_page_title()}
        </p>
        {org.purgeAt ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {m.org_deleted_purge_notice({ date: formatDate(org.purgeAt) })}
          </p>
        ) : null}
      </div>

      {isOwner ? (
        <div className="relative flex w-full max-w-xs flex-col gap-2 px-8 pb-8 pt-4">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={restoring}
            onClick={() => void onRestore()}
          >
            {restoring
              ? m.org_deleted_restore_in_progress()
              : m.org_deleted_restore_button()}
          </Button>
          {error ? (
            <p className="text-center text-sm text-destructive">{error}</p>
          ) : null}
        </div>
      ) : null}
    </DitherShell>
  )
}

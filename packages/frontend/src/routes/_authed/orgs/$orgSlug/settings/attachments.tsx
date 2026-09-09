import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import { orgDetailAtom } from "@/atoms/orgs"
import { AttachmentsBrowser } from "@/components/AttachmentsBrowser"
import { ErrorPage } from "@/components/ErrorPage"
import { m } from "@/paraglide/messages"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/settings/attachments"
)({
  component: AttachmentsSettings,
  loader: () => ({
    crumb: { type: "static" as const, label: m.attachments_crumb() }
  })
})

function AttachmentsSettings() {
  const { orgSlug } = Route.useParams()
  const orgResult = useAtomValue(orgDetailAtom(orgSlug))

  return Result.matchWithError(orgResult, {
    onInitial: () => <BrowserSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value: org }) =>
      org.role !== "owner" && org.role !== "admin" ? (
        <p className="text-sm text-destructive">
          {m.attachments_error_forbidden()}
        </p>
      ) : (
        <AttachmentsBrowser orgSlug={orgSlug} />
      )
  })
}

function BrowserSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="h-16 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-40 w-full animate-pulse rounded-lg bg-muted" />
    </div>
  )
}

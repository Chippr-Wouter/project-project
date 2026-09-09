import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import { createFileRoute, Outlet } from "@tanstack/react-router"
import * as Effect from "effect/Effect"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { projectsListAtom } from "@/atoms/projects"
import { orgDetailAtom, orgDetailBaseAtom } from "@/atoms/orgs"
import { DeletedOrgPage } from "@/components/DeletedOrgPage"
import { ErrorPage } from "@/components/ErrorPage"
import { NotFoundPage } from "@/components/NotFoundPage"
import { DitherShell } from "@/components/ui/dither-shell"

export const Route = createFileRoute("/_authed/orgs/$orgSlug")({
  component: OrgLayout,
  loader: async ({ context: { registry }, params, abortController }) => {
    const projects = Effect.runPromiseExit(
      Registry.getResult(registry, projectsListAtom(params.orgSlug)),
      { signal: abortController.signal }
    )
    await Effect.runPromiseExit(
      Registry.getResult(registry, orgDetailAtom(params.orgSlug)),
      { signal: abortController.signal }
    )
    await projects
  }
})

function OrgLayout() {
  const { orgSlug } = Route.useParams()
  const result = useAtomValue(orgDetailAtom(orgSlug))
  const refresh = useAtomRefresh(orgDetailBaseAtom(orgSlug))

  return Result.matchWithError(result, {
    onInitial: () => <DitherShell animated>{null}</DitherShell>,
    onError: (error) =>
      error._tag === "NotFound" ? (
        <NotFoundPage />
      ) : (
        <ErrorPage error={error} reset={refresh} />
      ),
    onDefect: (defect) => <ErrorPage error={defect} reset={refresh} />,
    onSuccess: ({ value }) =>
      value.deletedAt !== null ? (
        <DeletedOrgPage orgSlug={orgSlug} />
      ) : (
        <Outlet />
      )
  })
}

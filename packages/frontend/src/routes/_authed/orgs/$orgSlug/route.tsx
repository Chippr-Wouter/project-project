import { createFileRoute, notFound, Outlet } from "@tanstack/react-router"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import { DeletedOrgPage } from "@/components/DeletedOrgPage"
import { ApiClient } from "@/services/ApiClient"
import { AppLayer } from "@/runtime"

export const Route = createFileRoute("/_authed/orgs/$orgSlug")({
  component: OrgLayout,
  loader: async ({ params }) => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.org.get({ params: { orgSlug: params.orgSlug } })
      }).pipe(Effect.provide(AppLayer))
    )

    if (Exit.isFailure(exit)) {
      const failure = Cause.findErrorOption(exit.cause)
      if (Option.isSome(failure) && failure.value._tag === "NotFound") {
        throw notFound()
      }
      throw Cause.squash(exit.cause)
    }

    return { deleted: exit.value.deletedAt != null }
  }
})

function OrgLayout() {
  const { orgSlug } = Route.useParams()
  const { deleted } = Route.useLoaderData()

  if (deleted) return <DeletedOrgPage orgSlug={orgSlug} />
  return <Outlet />
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { createFileRoute, Link } from "@tanstack/react-router"
import * as DateTime from "effect/DateTime"
import { ArrowRight, Plus } from "lucide-react"
import { meAtom } from "@/atoms/auth"
import { projectsListAtom } from "@/atoms/projects"
import { PageContainer, PageHeader } from "@/components/page"
import { ProjectTile as ProjectIconTile } from "@/components/ProjectTile"
import { formatRelative } from "@/lib/relative-time"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import type { Project } from "@projectproject/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/")({
  component: Dashboard,
  loader: () => ({
    crumb: { type: "static" as const, label: "Dashboard", to: "/" }
  })
})

function Dashboard() {
  const { orgSlug } = Route.useParams()
  const me = useAtomValue(meAtom)
  const list = useAtomValue(projectsListAtom(orgSlug))
  const name = Result.isSuccess(me)
    ? me.value.name.split(" ")[0]
    : m.org_dashboard_greeting_fallback_name()
  const greeting = greet()

  return (
    <PageContainer>
      <PageHeader>
        <h1>{m.org_dashboard_greeting_line({ greeting, name })}</h1>
        <p>{m.org_dashboard_subtitle()}</p>
      </PageHeader>

      {Result.matchWithError(list, {
        onInitial: () => <TilesSkeleton />,
        onError: () => <NewProjectCTA orgSlug={orgSlug} />,
        onDefect: () => <NewProjectCTA orgSlug={orgSlug} />,
        onSuccess: ({ value }) =>
          value.length === 0 ? (
            <NewProjectCTA orgSlug={orgSlug} />
          ) : (
            <RecentProjects orgSlug={orgSlug} projects={value} />
          )
      })}
    </PageContainer>
  )
}

function greet(): string {
  const h = DateTime.toDate(DateTime.nowUnsafe()).getHours()
  if (h < 5) return m.org_dashboard_greeting_late()
  if (h < 12) return m.org_dashboard_greeting_morning()
  if (h < 18) return m.org_dashboard_greeting_afternoon()
  return m.org_dashboard_greeting_evening()
}

function RecentProjects({
  orgSlug,
  projects
}: {
  orgSlug: string
  projects: ReadonlyArray<Project>
}) {
  const sorted = [...projects].toSorted(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )
  const top = sorted.slice(0, 6)
  const hasMore = sorted.length > top.length

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold tracking-tight">
          {m.org_dashboard_recent_projects_heading()}
        </h2>
        <Link
          to="/orgs/$orgSlug/projects"
          params={{ orgSlug }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {m.org_dashboard_all_projects_link()}
          <ArrowRight className="size-3.5" strokeWidth={1.75} />
        </Link>
      </div>

      <div className="grid gap-2 @container sm:grid-cols-2 lg:grid-cols-3">
        {top.map((p) => (
          <ProjectTile key={p.slug} orgSlug={orgSlug} project={p} />
        ))}
        <NewProjectTile orgSlug={orgSlug} compact={top.length > 0} />
      </div>

      {hasMore && (
        <p className="text-xs text-muted-foreground">
          {m.org_dashboard_more_projects_prefix({
            count: sorted.length - top.length
          })}{" "}
          <Link
            to="/orgs/$orgSlug/projects"
            params={{ orgSlug }}
            className="underline-offset-2 hover:underline"
          >
            {m.org_dashboard_more_projects_link()}
          </Link>
          {m.org_dashboard_more_projects_suffix()}
        </p>
      )}
    </section>
  )
}

function ProjectTile({
  orgSlug,
  project
}: {
  orgSlug: string
  project: Project
}) {
  return (
    <Link
      to="/orgs/$orgSlug/projects/$slug"
      params={{ orgSlug, slug: project.slug }}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-border bg-background p-4 transition-all",
        "hover:border-border/80 hover:bg-accent/30 hover:shadow-sm"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <ProjectIconTile
          icon={project.icon}
          color={project.color}
          size="sm"
          seed={project.slug}
        />
        <ArrowRight
          className="size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
          strokeWidth={1.75}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          /{project.slug}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {m.org_dashboard_project_created_label({
          when: formatRelative(project.createdAt)
        })}
      </div>
    </Link>
  )
}

function NewProjectTile({
  orgSlug,
  compact
}: {
  orgSlug: string
  compact: boolean
}) {
  return (
    <Link
      to="/orgs/$orgSlug/projects"
      params={{ orgSlug }}
      className={cn(
        "group flex flex-col gap-3 rounded-xl border border-dashed border-border bg-background/50 p-4 transition-colors",
        "hover:border-border hover:bg-accent/30",
        compact ? "min-h-[8rem] items-center justify-center text-center" : ""
      )}
    >
      <div className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
        <Plus className="size-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {m.org_dashboard_new_project_tile_title()}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {m.org_dashboard_new_project_tile_subtitle()}
        </div>
      </div>
    </Link>
  )
}

function NewProjectCTA({ orgSlug }: { orgSlug: string }) {
  return (
    <Link
      to="/orgs/$orgSlug/projects"
      params={{ orgSlug }}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background/50 px-6 py-12 text-center transition-colors",
        "hover:border-border hover:bg-accent/30"
      )}
    >
      <div className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
        <Plus className="size-5" strokeWidth={1.75} />
      </div>
      <div>
        <div className="text-sm font-medium">
          {m.org_dashboard_first_project_cta_title()}
        </div>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          {m.org_dashboard_first_project_cta_body()}
        </p>
      </div>
    </Link>
  )
}

function TilesSkeleton() {
  return (
    <section className="flex flex-col gap-3">
      <div className="h-6 w-40 skeleton rounded-md bg-muted/60" />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 skeleton rounded-xl border border-border bg-background"
          />
        ))}
      </div>
    </section>
  )
}

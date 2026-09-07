import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import { Link, Outlet, useLocation } from "@tanstack/react-router"
import { createFileRoute } from "@tanstack/react-router"
import { useCallback } from "react"
import { motion, useReducedMotion } from "motion/react"
import { GitBranch, SlidersHorizontal, Users, Workflow } from "lucide-react"
import { projectAtom, projectKey } from "@/atoms/projects"
import { PageContainer, PageHeader } from "@/components/page"
import { RailBackLink } from "@/components/RailBackLink"
import { useSidebarSlot } from "@/components/SidebarSlot"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

type SectionKey = "general" | "team" | "workflow" | "integrations"

const SECTIONS = [
  {
    key: "general",
    label: m.project_settings_general_tab(),
    icon: SlidersHorizontal,
    heading: m.project_settings_general_heading(),
    description: m.project_settings_general_description()
  },
  {
    key: "team",
    label: m.project_settings_team_tab(),
    icon: Users,
    heading: m.project_settings_team_heading(),
    description: m.project_settings_team_description()
  },
  {
    key: "workflow",
    label: m.project_settings_workflow_tab(),
    icon: Workflow,
    heading: m.project_settings_workflow_heading(),
    description: m.project_settings_workflow_description()
  },
  {
    key: "integrations",
    label: m.project_settings_integrations_tab(),
    icon: GitBranch,
    heading: m.project_settings_integrations_heading(),
    description: m.project_settings_integrations_description()
  }
] satisfies ReadonlyArray<{
  key: SectionKey
  label: string
  icon: typeof SlidersHorizontal
  heading: string
  description: string
}>

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/settings"
)({
  component: SettingsLayout,
  loader: () => ({
    crumb: { type: "static" as const, label: m.project_detail_tab_settings() }
  })
})

function SettingsLayout() {
  const { orgSlug, slug } = Route.useParams()
  const location = useLocation()
  const renderRail = useCallback(
    () => <SettingsRail orgSlug={orgSlug} slug={slug} />,
    [orgSlug, slug]
  )
  useSidebarSlot(`settings:${orgSlug}/${slug}`, renderRail)

  const activeSection =
    SECTIONS.find((section) => {
      const base = `/orgs/${orgSlug}/projects/${slug}/settings/${section.key}`
      return (
        location.pathname === base || location.pathname.startsWith(`${base}/`)
      )
    }) ?? SECTIONS[0]

  return (
    <PageContainer>
      <PageHeader>
        <h1>{activeSection.heading}</h1>
        <p>{activeSection.description}</p>
      </PageHeader>
      <Outlet />
    </PageContainer>
  )
}

function projectSettingsLayoutId(orgSlug: string, slug: string) {
  return `project-settings-row:${orgSlug}/${slug}`
}

function SettingsRail({ orgSlug, slug }: { orgSlug: string; slug: string }) {
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const project = useAtomValue(projectAtom(projectKey(orgSlug, slug)))
  const projectName = Result.isSuccess(project) ? project.value.name : slug
  const projectIcon = Result.isSuccess(project) ? project.value.icon : null

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <RailBackLink
          to="/orgs/$orgSlug/projects/$slug"
          params={{ orgSlug, slug }}
          label={m.project_detail_tab_settings()}
        />
        <motion.div
          layoutId={
            reduceMotion ? undefined : projectSettingsLayoutId(orgSlug, slug)
          }
          transition={transitions.layout}
          className="flex items-center gap-2.5 rounded-lg bg-accent/60 px-3 py-2 text-[13px] text-foreground"
        >
          {projectIcon ? (
            <span
              aria-hidden
              className="inline-flex size-4 shrink-0 items-center justify-center overflow-hidden text-[13px] leading-none"
            >
              {projectIcon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate font-medium">
            {projectName}
          </span>
        </motion.div>
      </div>
      <nav className="flex flex-col gap-1">
        {SECTIONS.map((section) => {
          const Icon = section.icon
          const active =
            location.pathname ===
              `/orgs/${orgSlug}/projects/${slug}/settings/${section.key}` ||
            location.pathname.startsWith(
              `/orgs/${orgSlug}/projects/${slug}/settings/${section.key}/`
            )
          return (
            <Link
              key={section.key}
              to={`/orgs/$orgSlug/projects/$slug/settings/${section.key}`}
              params={{ orgSlug, slug }}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-all duration-100 active:scale-[0.97]",
                active
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

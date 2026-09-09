import { flushSync } from "react-dom"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  createFileRoute,
  Link,
  Outlet,
  retainSearchParams,
  useMatches,
  useNavigate
} from "@tanstack/react-router"
import * as DateTime from "effect/DateTime"
import {
  startTransition,
  lazy,
  Suspense,
  useOptimistic,
  type MouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from "react"
import {
  CalendarRange,
  Columns3,
  FileText,
  GitBranch,
  Info,
  ListChecks,
  Rows3,
  UserPlus,
  Workflow,
  X,
  type LucideIcon
} from "lucide-react"
import { statusMetaFor } from "@/lib/ticket-meta"
import {
  projectKey as projectStatusKey,
  projectStatusesAtom
} from "@/atoms/projectStatuses"
import { boardStatusesFor } from "@/components/sprints/board-utils"
import { useProjectRole } from "@/lib/projectRole"
import { useProjectGitStatePolling } from "@/hooks/useProjectGitStatePolling"
import {
  projectAtom,
  projectKey,
  updateProjectSetupAtom
} from "@/atoms/projects"
import { ticketsCountAtom, ticketsCountKey } from "@/atoms/tickets"
import {
  projectKey as sprintsProjectKey,
  sprintsListAtom
} from "@/atoms/sprints"
import { projectGitStatesAtom } from "@/atoms/github"
import { everhourProjectStatusAtom } from "@/atoms/everhour"
import {
  activeAndPlannedCount,
  pickActiveSprint,
  pickEarliestPlannedSprint,
  sprintState
} from "@projectproject/shared"
import { SPRINT_STATE_META } from "@/components/sprints/SprintChip"
import { motion } from "motion/react"
import { ProjectHeader } from "@/components/ProjectHeader"
import { useSidebarSection } from "@/components/SidebarSlot"
import { cn } from "@/lib/utils"
import { springs } from "@/lib/springs"
import {
  SEGMENTED_ITEM_CLASS,
  SegmentedTabs,
  type SegmentedItem
} from "@/components/SegmentedTabs"
import { ErrorPage } from "@/components/ErrorPage"
import { NotFoundPage } from "@/components/NotFoundPage"
import { PageContainer } from "@/components/page"
import { m } from "@/paraglide/messages"
import { TagRenamesProvider } from "@/components/TagRenamesProvider"
import { ProjectContext } from "./-context"
import type { FileRouteTypes } from "@/routeTree.gen"
import type {
  Group,
  ProjectDetail as ProjectDetailType,
  ProjectStatus
} from "@projectproject/shared"

const BannerPrototype = import.meta.env.DEV
  ? lazy(() => import("@/components/ProjectBannerPrototype"))
  : null

export const Route = createFileRoute("/_authed/orgs/$orgSlug/projects/$slug")({
  validateSearch: (
    search: Record<string, unknown>
  ): { bannerPrototype?: "image" | "mask" } =>
    import.meta.env.DEV &&
    (search.bannerPrototype === "image" || search.bannerPrototype === "mask")
      ? { bannerPrototype: search.bannerPrototype }
      : {},
  search: { middlewares: [retainSearchParams(["bannerPrototype"])] },
  component: ProjectLayout,
  loader: ({ context, params }) => {
    const { orgSlug, slug } = params
    const { registry } = context
    registry.mount(projectAtom(projectKey(orgSlug, slug)))()
    registry.mount(ticketsCountAtom(ticketsCountKey(orgSlug, slug, {})))()
    registry.mount(sprintsListAtom(sprintsProjectKey(orgSlug, slug)))()
    registry.mount(projectStatusesAtom(projectStatusKey(orgSlug, slug)))()
    registry.mount(everhourProjectStatusAtom(projectKey(orgSlug, slug)))()
    return {
      crumb: [
        {
          type: "static" as const,
          label: m.chrome_sidebar_projects(),
          to: "/orgs/$orgSlug/projects",
          params: { orgSlug }
        },
        {
          type: "project" as const,
          orgSlug,
          slug
        }
      ]
    }
  }
})

const TICKET_DETAIL_ROUTE_ID: FileRouteTypes["id"] =
  "/_authed/orgs/$orgSlug/projects/$slug/tickets/$id"
const PROJECT_SETTINGS_ROUTE_ID: FileRouteTypes["id"] =
  "/_authed/orgs/$orgSlug/projects/$slug/settings"

function ProjectLayout() {
  const { orgSlug, slug } = Route.useParams()
  const { bannerPrototype } = Route.useSearch()
  const project = useAtomValue(projectAtom(projectKey(orgSlug, slug)))
  const headerHidden = useMatches({
    select: (matches) =>
      matches.some(
        (match) =>
          match.routeId === TICKET_DETAIL_ROUTE_ID ||
          match.routeId === PROJECT_SETTINGS_ROUTE_ID
      )
  })

  return Result.matchWithError(project, {
    onInitial: () => (
      <PageContainer>
        <Skeleton />
      </PageContainer>
    ),
    onError: (error) =>
      error._tag === "NotFound" ? (
        <NotFoundPage
          contained
          title={m.project_detail_not_found_title()}
          body={m.project_detail_not_found_body({ slug })}
        />
      ) : (
        <ErrorPage
          contained
          error={error}
          title={m.project_detail_load_error_title()}
          body={m.project_detail_load_error_body()}
        />
      ),
    onDefect: (defect) => (
      <ErrorPage
        contained
        error={defect}
        title={m.project_detail_load_error_title()}
        body={m.project_detail_load_error_body()}
      />
    ),
    onSuccess: ({ value }) => (
      <ProjectContext.Provider value={value}>
        <TagRenamesProvider>
          <ProjectGitStatePolling
            orgSlug={orgSlug}
            slug={slug}
            enabled={value.github !== null}
          />
          <ProjectSetupSlot orgSlug={orgSlug} slug={slug} project={value} />
          <div
            className={cn(
              "flex flex-1 flex-col gap-6",
              BannerPrototype && bannerPrototype && "relative isolate"
            )}
          >
            {BannerPrototype && bannerPrototype && (
              <Suspense fallback={null}>
                <BannerPrototype
                  key={`${orgSlug}/${slug}`}
                  mode={bannerPrototype}
                />
              </Suspense>
            )}
            {!headerHidden && (

              <PageContainer>
                <ProjectHeader
                  orgSlug={orgSlug}
                  slug={value.slug}
                  name={value.name}
                  project={value}
                />
                <TabsNav orgSlug={orgSlug} slug={slug} project={value} />
              </PageContainer>
            )}
            <Outlet />
          </div>
        </TagRenamesProvider>
      </ProjectContext.Provider>
    )
  })
}

function ProjectGitStatePolling({
  orgSlug,
  slug,
  enabled
}: {
  orgSlug: string
  slug: string
  enabled: boolean
}) {
  useProjectGitStatePolling(orgSlug, slug, enabled)
  return null
}

function ProjectSetupSlot({
  orgSlug,
  slug,
  project
}: {
  orgSlug: string
  slug: string
  project: ProjectDetailType
}) {
  const { role } = useProjectRole()
  const canManage = role === "owner" || role === "admin"
  const render = useCallback(
    () => (
      <ProjectSetupRail
        orgSlug={orgSlug}
        slug={slug}
        project={project}
        canManage={canManage}
      />
    ),
    [orgSlug, slug, project, canManage]
  )
  useSidebarSection(`project-setup:${orgSlug}/${slug}`, render)
  return null
}

function ProjectSetupRail({
  orgSlug,
  slug,
  project,
  canManage
}: {
  orgSlug: string
  slug: string
  project: ProjectDetailType
  canManage: boolean
}) {
  const key = projectKey(orgSlug, slug)
  const gitStates = useAtomValue(projectGitStatesAtom(key))
  const updateSetup = useAtomSet(updateProjectSetupAtom(key))
  if (!canManage) return null

  const brokenGithub =
    Result.isSuccess(gitStates) &&
    (gitStates.value.tokenStatus !== "ok" ||
      gitStates.value.repoStatus === "gone")
  const items = [
    !project.setup.workflowReviewedAt
      ? {
          key: "workflow",
          to: "/orgs/$orgSlug/projects/$slug/settings/workflow" as const,
          label: m.project_setup_review_workflow(),
          icon: Workflow,
          dismiss: null
        }
      : null,
    project.members.length < 2 && !project.setup.invitePeopleDismissedAt
      ? {
          key: "invite",
          to: "/orgs/$orgSlug/projects/$slug/settings/team" as const,
          label: m.project_setup_invite_people(),
          icon: UserPlus,
          dismiss: () =>
            updateSetup({
              invitePeopleDismissedAt: DateTime.toDate(DateTime.nowUnsafe())
            })
        }
      : null,
    brokenGithub || (!project.github && !project.setup.connectGithubDismissedAt)
      ? {
          key: "github",
          to: "/orgs/$orgSlug/projects/$slug/settings/integrations" as const,
          label: m.project_setup_connect_github(),
          icon: GitBranch,
          dismiss: project.github
            ? null
            : () =>
                updateSetup({
                  connectGithubDismissedAt: DateTime.toDate(
                    DateTime.nowUnsafe()
                  )
                })
        }
      : null
  ].filter((item) => item !== null)

  if (items.length === 0) return null

  return (
    <div className="flex flex-col gap-1 px-3 pt-6">
      <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">
        {m.project_setup_section_label()}
      </div>
      <nav className="flex flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <div key={item.key} className="group/setup-row relative">
              <Link
                to={item.to}
                params={{ orgSlug, slug }}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 pr-8 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <Icon className="size-4" strokeWidth={1.75} />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </Link>
              {item.dismiss ? (
                <button
                  type="button"
                  aria-label={m.project_setup_dismiss_aria_label({
                    item: item.label
                  })}
                  onClick={item.dismiss}
                  className="absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground opacity-0 transition-colors transition-transform duration-100 hover:bg-background hover:text-foreground group-hover/setup-row:opacity-100 active:scale-[0.97]"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

type TabKey = "tickets" | "sprints" | "about"
type TabDef = {
  key: TabKey
  to:
    | "/orgs/$orgSlug/projects/$slug"
    | "/orgs/$orgSlug/projects/$slug/sprints"
    | "/orgs/$orgSlug/projects/$slug/about"
  label: () => string
  icon: typeof ListChecks
  exact: boolean
  countFor?: "tickets" | "sprints" | "members"
}

const TABS: ReadonlyArray<TabDef> = [
  {
    key: "tickets",
    to: "/orgs/$orgSlug/projects/$slug",
    label: () => m.project_detail_tab_backlog(),
    icon: ListChecks,
    exact: true,
    countFor: "tickets"
  },
  {
    key: "sprints",
    to: "/orgs/$orgSlug/projects/$slug/sprints",
    label: () => m.project_detail_tab_sprints(),
    icon: CalendarRange,
    exact: false,
    countFor: "sprints"
  },
  {
    key: "about",
    to: "/orgs/$orgSlug/projects/$slug/about",
    label: () => m.project_detail_tab_about(),
    icon: Info,
    exact: false
  }
]

function TabsNav({
  orgSlug,
  slug,
  project
}: {
  orgSlug: string
  slug: string
  project: ProjectDetailType
}) {
  const pathname = useMatches({
    select: (matches) => matches[matches.length - 1]?.pathname ?? ""
  })
  const base = `/orgs/${orgSlug}/projects/${slug}`
  const ticketsResult = useAtomValue(
    ticketsCountAtom(ticketsCountKey(orgSlug, slug, {}))
  )
  const ticketsCount = Result.isSuccess(ticketsResult)
    ? ticketsResult.value.total
    : null
  const sprintsResult = useAtomValue(
    sprintsListAtom(sprintsProjectKey(orgSlug, slug))
  )
  const sprintsCount = Result.isSuccess(sprintsResult)
    ? activeAndPlannedCount(sprintsResult.value)
    : null

  const matchesTab = (key: TabKey): boolean => {
    const t = TABS.find((x) => x.key === key)!
    const target = t.to.replace("$orgSlug", orgSlug).replace("$slug", slug)
    return t.exact
      ? pathname === target ||
          pathname === target + "/" ||
          pathname === base ||
          pathname === base + "/"
      : pathname === target || pathname.startsWith(target + "/")
  }

  const [selectedTab, selectTab] = useOptimistic(
    TABS.find((tab) => matchesTab(tab.key))?.key ?? "tickets"
  )
  const navigate = useNavigate()
  const isActive = (key: TabKey) => selectedTab === key

  const statusesResult = useAtomValue(
    projectStatusesAtom(projectStatusKey(orgSlug, slug))
  )
  const statuses = Result.isSuccess(statusesResult) ? statusesResult.value : []
  const statusSlugs = boardStatusesFor(statuses)
  const byStatusRaw = Result.isSuccess(ticketsResult)
    ? (ticketsResult.value.byStatus as Record<string, number>)
    : {}
  const ticketBreakdown: Record<string, number> = Object.fromEntries(
    statusSlugs.map((s) => [s, byStatusRaw[s] ?? 0])
  )
  const sprints = Result.isSuccess(sprintsResult) ? sprintsResult.value : []
  const sprintTarget = Result.isSuccess(sprintsResult)
    ? pickSprintNavigationTarget(sprintsResult.value)
    : null
  const items: ReadonlyArray<SegmentedItem<TabKey>> = TABS.map((t) => ({
    key: t.key,
    label: t.label(),
    icon: t.icon,
    badge:
      t.countFor === "tickets"
        ? ticketsCount
        : t.countFor === "sprints"
          ? sprintsCount
          : t.countFor === "members"
            ? project.members.length
            : null
  }))

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedTabs
        items={items}
        layoutId={`project-tabs-${slug}`}
        className="project-tabs"
        isActive={isActive}
        renderItem={(item, content, { active }) => {
          const def = TABS.find((t) => t.key === item.key)!
          const destination =
            item.key === "sprints" && sprintTarget
              ? {
                  to: "/orgs/$orgSlug/projects/$slug/sprints/$groupId" as const,
                  params: { orgSlug, slug, groupId: sprintTarget.id }
                }
              : { to: def.to, params: { orgSlug, slug } }
          const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            event.preventDefault()
            startTransition(async () => {
              flushSync(() => selectTab(item.key))
              await new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => window.setTimeout(resolve, 0))
                })
              })
              await navigate(destination)
            })
          }

          if (item.key === "tickets" && ticketsCount !== null) {
            return (
              <Link
                onClick={onClick}
                {...destination}
                className={SEGMENTED_ITEM_CLASS(active)}
              >
                {active && (
                  <motion.span
                    layoutId={`project-tabs-${slug}-active`}
                    transition={springs.moderate}
                    className="absolute inset-0 z-0 rounded-lg bg-accent"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5 transition-opacity group-hover/seg-item:opacity-0 group-hover/seg-item:duration-0">
                  <ListChecks className="size-3.5" strokeWidth={1.75} />
                  <span>{m.project_detail_tab_backlog()}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 font-mono text-[10px] tabular-nums",
                      active
                        ? "bg-foreground/10 text-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {ticketsCount}
                  </span>
                </span>
                <span className="pointer-events-none absolute inset-0 z-10 opacity-0 transition-opacity group-hover/seg-item:opacity-100 group-hover/seg-item:duration-0">
                  <MarqueeIfOverflow>
                    <TicketsBreakdown
                      counts={ticketBreakdown}
                      statuses={statuses}
                    />
                  </MarqueeIfOverflow>
                </span>
              </Link>
            )
          }
          if (item.key === "sprints" && sprintsCount !== null) {
            const children = (
              <>
                {active && (
                  <motion.span
                    layoutId={`project-tabs-${slug}-active`}
                    transition={springs.moderate}
                    className="absolute inset-0 z-0 rounded-lg bg-accent"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5 transition-opacity group-hover/seg-item:opacity-0 group-hover/seg-item:duration-0">
                  <CalendarRange className="size-3.5" strokeWidth={1.75} />
                  <span>{m.project_detail_tab_sprints()}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 font-mono text-[10px] tabular-nums",
                      active
                        ? "bg-foreground/10 text-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {sprintsCount}
                  </span>
                </span>
                <span className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 whitespace-nowrap opacity-0 transition-opacity group-hover/seg-item:opacity-100 group-hover/seg-item:duration-0">
                  <SprintsBreakdown sprints={sprints} />
                </span>
              </>
            )
            return (
              <Link
                onClick={onClick}
                {...destination}
                className={SEGMENTED_ITEM_CLASS(active)}
              >
                {children}
              </Link>
            )
          }
          return (
            <Link
              onClick={onClick}
              {...destination}
              className={SEGMENTED_ITEM_CLASS(active)}
            >
              {content}
            </Link>
          )
        }}
      />
      <SprintViewSwitcher orgSlug={orgSlug} slug={slug} />
    </div>
  )
}

function pickSprintNavigationTarget(
  sprints: ReadonlyArray<Group>
): Group | null {
  const active = pickActiveSprint(sprints)
  if (active) return active
  const planned = pickEarliestPlannedSprint(sprints)
  if (planned) return planned
  const completed = sprints
    .filter((s) => s.completedAt !== null)
    .toSorted(
      (a, b) =>
        (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0)
    )
  return completed[0] ?? null
}

function SprintViewSwitcher({
  orgSlug,
  slug
}: {
  orgSlug: string
  slug: string
}) {
  const navigate = useNavigate()
  const matches = useMatches()
  const sprintMatch = matches.find(
    (m) =>
      m.routeId === "/_authed/orgs/$orgSlug/projects/$slug/sprints/$groupId"
  )
  if (!sprintMatch) return null
  const search = sprintMatch.search as {
    view?: "list" | "board" | "description"
  }
  const view: "list" | "board" | "description" = search.view ?? "board"
  const { groupId } = sprintMatch.params as { groupId: string }
  const setView = (next: "list" | "board" | "description") => {
    if (next === view) return
    void navigate({
      to: "/orgs/$orgSlug/projects/$slug/sprints/$groupId",
      params: { orgSlug, slug, groupId },
      search: (prev) => ({ ...prev, view: next })
    })
  }
  const items: ReadonlyArray<SegmentedItem<"list" | "board" | "description">> =
    [
      { key: "list", label: m.sprints_view_list(), icon: Rows3 },
      { key: "board", label: m.sprints_view_board(), icon: Columns3 },
      {
        key: "description",
        label: m.sprints_view_description(),
        icon: FileText
      }
    ]
  return (
    <div
      role="group"
      aria-label={m.sprints_view_tabs_aria_label()}
      className="ml-auto"
    >
      <SegmentedTabs
        items={items}
        layoutId={`sprint-view-${groupId}`}
        isActive={(k) => k === view}
        renderItem={(item, content, { active }) => (
          <button
            type="button"
            onClick={() => setView(item.key)}
            aria-pressed={active}
            className={SEGMENTED_ITEM_CLASS(active)}
          >
            {content}
          </button>
        )}
      />
    </div>
  )
}

function MarqueeIfOverflow({
  children,
  speedPxPerSec = 35
}: {
  children: ReactNode
  speedPxPerSec?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<{ overflow: boolean; duration: number }>({
    overflow: false,
    duration: 20
  })

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = measureRef.current
    if (!container || !measure) return
    const update = () => {
      const cw = container.clientWidth
      const iw = measure.scrollWidth
      if (cw === 0 || iw === 0) return
      const overflow = iw > cw
      const duration = Math.max(8, iw / speedPxPerSec)
      setState((prev) =>
        prev.overflow === overflow && Math.abs(prev.duration - duration) < 0.5
          ? prev
          : { overflow, duration }
      )
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(container)
    ro.observe(measure)
    return () => ro.disconnect()
  }, [speedPxPerSec, children])

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full items-center overflow-hidden",
        state.overflow &&
          "[mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]"
      )}
    >
      {state.overflow ? (
        <div
          className="flex w-max items-center animate-marquee-x [animation-play-state:paused] group-hover/seg-item:[animation-play-state:running]"
          style={{ animationDuration: `${state.duration}s` }}
        >
          <div
            ref={measureRef}
            className="flex shrink-0 items-center gap-2 pr-2"
          >
            {children}
          </div>
          <div aria-hidden className="flex shrink-0 items-center gap-2 pr-2">
            {children}
          </div>
        </div>
      ) : (
        <div
          ref={measureRef}
          className="flex w-full items-center justify-center gap-2 whitespace-nowrap"
        >
          {children}
        </div>
      )}
    </div>
  )
}

function TicketsBreakdown({
  counts,
  statuses
}: {
  counts: Record<string, number>
  statuses: ReadonlyArray<ProjectStatus>
}) {
  const slugs = boardStatusesFor(statuses)
  return (
    <>
      {slugs.map((s) => {
        const meta = statusMetaFor(s, statuses)
        return (
          <BadgeStat
            key={s}
            count={counts[s] ?? 0}
            icon={meta.icon}
            className={meta.className}
            color={meta.color ?? undefined}
          />
        )
      })}
    </>
  )
}

function SprintsBreakdown({ sprints }: { sprints: ReadonlyArray<Group> }) {
  const counts = { active: 0, planned: 0, completed: 0 }
  const now = DateTime.toDate(DateTime.nowUnsafe())
  for (const s of sprints) counts[sprintState(s, now)]++
  const order: ReadonlyArray<keyof typeof counts> = [
    "active",
    "planned",
    "completed"
  ]
  return (
    <>
      {order.map((state) => (
        <BadgeStat
          key={state}
          count={counts[state]}
          icon={SPRINT_STATE_META[state].icon}
          className={SPRINT_STATE_META[state].className}
        />
      ))}
    </>
  )
}

function BadgeStat({
  count,
  icon: Icon,
  className,
  color
}: {
  count: number
  icon: LucideIcon
  className: string
  color?: string
}) {
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-[10px] font-medium tabular-nums text-foreground">
      <Icon
        className={`size-3 ${className}`}
        style={color ? { color } : undefined}
        strokeWidth={1.75}
      />
      {count}
    </span>
  )
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-12 skeleton rounded-lg bg-muted/60" />
      <div className="h-9 skeleton rounded-lg bg-muted/60" />
      <div className="h-40 skeleton rounded-xl bg-muted/60" />
    </div>
  )
}

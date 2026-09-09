import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import {
  createFileRoute,
  Link,
  Navigate,
  Outlet,
  useLocation
} from "@tanstack/react-router"
import {
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  UserRound
} from "lucide-react"
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion
} from "motion/react"
import { logoutAtom, meAtom } from "@/atoms/auth"
import { projectsListAtom } from "@/atoms/projects"
import { Breadcrumbs } from "@/components/Breadcrumbs"
import { ErrorPage } from "@/components/ErrorPage"
import { LoaderOverlay } from "@/components/Loader/LoaderOverlay"
import { Logo, Wordmark } from "@/components/Logo"
import { OrgSwitcher } from "@/components/OrgSwitcher"
import { RunningTimerIndicator } from "@/components/time/RunningTimerIndicator"
import {
  SidebarDrawerAutoCloseProvider,
  SidebarSlotProvider,
  useSidebarSectionContent,
  useSidebarSlotContent
} from "@/components/SidebarSlot"
import { ThemeSwitcher } from "@/components/ThemeSwitcher"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"
import { useCallback, useEffect, useRef, useState } from "react"
import { usePrefetch } from "@/hooks/usePrefetch"
import { authedRouteRedirect } from "@/lib/authRedirect"
import { projectPrefetchAtoms } from "@/lib/prefetch"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

import type { User } from "@projectproject/shared"
import type { LucideIcon } from "lucide-react"

export const Route = createFileRoute("/_authed")({ component: AuthedLayout })

function AuthedLayout() {
  const me = useAtomValue(meAtom)
  const { pathname } = useLocation()

  return Result.matchWithError(me, {
    onInitial: () => <LoaderOverlay active />,
    onError: () => <Navigate to="/login" replace />,
    onDefect: (defect) => <ErrorPage error={defect} />,
    onSuccess: ({ value }) => {
      const redirect = authedRouteRedirect(pathname, value.activeOrgSlug)
      if (redirect?.to === "/welcome") {
        return <Navigate to="/welcome" replace />
      }
      if (redirect) {
        return <Navigate to="/orgs/$orgSlug" params={redirect.params} replace />
      }
      return (
        <SidebarSlotProvider>
          <Shell user={value} />
        </SidebarSlotProvider>
      )
    }
  })
}

function Shell({ user }: { user: User }) {
  return (
    <div className="h-full transition-[padding] duration-300 ease-out motion-reduce:transition-none lg:p-3">
      <div className="grid h-full grid-cols-1 grid-rows-[3.5rem_1fr] overflow-hidden bg-background transition-[border-radius,box-shadow] duration-300 ease-out motion-reduce:transition-none lg:grid-cols-[14rem_1fr] lg:rounded-2xl lg:shadow-sm lg:ring-1 lg:ring-border/60">
        <Sidebar user={user} />
        <Topbar user={user} />
        <main className="flex min-h-0 overflow-hidden p-2 pt-0">
          <div
            data-scroll-root
            className="min-w-0 flex-1 overflow-auto rounded-xl bg-muted/60 [scrollbar-gutter:stable]"
          >
            <div data-scroll-content className="flex min-h-full flex-col p-6">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function Sidebar({ user }: { user: User }) {
  return (
    <aside className="row-span-2 hidden lg:flex">
      <LayoutGroup id="sidebar-desktop">
        <SidebarContent user={user} />
      </LayoutGroup>
    </aside>
  )
}

function SidebarContent({ user }: { user: User }) {
  const orgSlug = user.activeOrgSlug
  const slot = useSidebarSlotContent()
  const section = useSidebarSectionContent()
  const reduceMotion = useReducedMotion()
  const railScale = reduceMotion ? 1 : 1.02
  const navScale = reduceMotion ? 1 : 0.98

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex h-14 items-center gap-3 px-4 text-foreground">
        <Logo className="size-8" />
        <Wordmark className="h-5 w-auto" />
        {orgSlug ? <OrgSwitcher /> : null}
      </div>
      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} mode="popLayout">
          {slot ? (
            <motion.div
              key="rail"
              initial={{ opacity: 0, scale: railScale }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: railScale, pointerEvents: "none" }}
              transition={transitions.pop}
              className="absolute inset-0 overflow-y-auto px-3 py-2 will-change-transform"
            >
              {slot}
            </motion.div>
          ) : (
            <motion.div
              key="nav"
              initial={{ opacity: 0, scale: navScale }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: navScale, pointerEvents: "none" }}
              transition={transitions.pop}
              className="absolute inset-0 overflow-y-auto will-change-transform"
            >
              <PrimaryNav orgSlug={orgSlug} />
              <AnimatePresence initial={false}>
                {section ? (
                  <motion.div
                    key="section"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={transitions.presence}
                  >
                    {section}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="p-3">
        <ThemeSwitcher />
      </div>
    </div>
  )
}

function PrimaryNav({ orgSlug }: { orgSlug: string | null }) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-2">
      {orgSlug ? (
        <NavItem
          to="/orgs/$orgSlug"
          params={{ orgSlug }}
          icon={LayoutDashboard}
          label={m.chrome_sidebar_dashboard()}
          exact
        />
      ) : (
        <NavItem
          to="/"
          icon={LayoutDashboard}
          label={m.chrome_sidebar_dashboard()}
          exact
        />
      )}
      {orgSlug && <ProjectsGroup orgSlug={orgSlug} />}
    </nav>
  )
}

function ProjectsGroup({ orgSlug }: { orgSlug: string }) {
  const { pathname } = useLocation()
  const reduceMotion = useReducedMotion()
  const projectsBase = `/orgs/${orgSlug}/projects`
  const expanded =
    pathname === projectsBase || pathname.startsWith(`${projectsBase}/`)
  const listResult = useAtomValue(projectsListAtom(orgSlug))
  const projects = Result.isSuccess(listResult)
    ? [...listResult.value].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      )
    : []
  const activeSlug = matchActiveProjectSlug(pathname, orgSlug)

  return (
    <div
      className={cn("rounded-lg transition-colors", expanded && "bg-accent")}
    >
      <NavItem
        to="/orgs/$orgSlug/projects"
        params={{ orgSlug }}
        icon={FolderKanban}
        label={m.chrome_sidebar_projects()}
      />
      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="projects-list"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={transitions.layout}
            className="overflow-hidden"
          >
            <ul className="flex flex-col gap-0.5 pb-2">
              {projects.map((p) => (
                <ProjectsGroupRow
                  key={p.slug}
                  orgSlug={orgSlug}
                  slug={p.slug}
                  name={p.name}
                  icon={p.icon}
                  active={p.slug === activeSlug}
                />
              ))}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function projectSettingsLayoutId(orgSlug: string, slug: string) {
  return `project-settings-row:${orgSlug}/${slug}`
}

function ProjectsGroupRow({
  orgSlug,
  slug,
  name,
  icon,
  active
}: {
  orgSlug: string
  slug: string
  name: string
  icon: string
  active: boolean
}) {
  const reduceMotion = useReducedMotion()
  const settingsLabel = m.project_sidebar_settings_aria_label({ name })
  const prefetch = usePrefetch(
    useCallback(() => projectPrefetchAtoms(orgSlug, slug), [orgSlug, slug])
  )

  return (
    <motion.li
      layoutId={
        reduceMotion ? undefined : projectSettingsLayoutId(orgSlug, slug)
      }
      transition={transitions.layout}
      className="group/project-row flex items-center rounded-lg transition-colors hover:bg-accent/60"
    >
      <Link
        to="/orgs/$orgSlug/projects/$slug"
        params={{ orgSlug, slug }}
        {...prefetch}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pl-3 pr-1 text-[13px] transition-colors",
          active
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-flex size-4 shrink-0 items-center justify-center overflow-hidden text-[13px] leading-none transition-[filter,opacity] duration-150",
            !active && "opacity-60 grayscale"
          )}
        >
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </Link>
      <Link
        to="/orgs/$orgSlug/projects/$slug/settings"
        params={{ orgSlug, slug }}
        aria-label={settingsLabel}
        title={settingsLabel}
        className={cn(
          "mr-1 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors transition-transform duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.97]",
          "opacity-0 group-hover/project-row:opacity-100 group-focus-within/project-row:opacity-100"
        )}
      >
        <Settings className="size-3.5" strokeWidth={1.75} />
      </Link>
    </motion.li>
  )
}

function matchActiveProjectSlug(
  pathname: string,
  orgSlug: string
): string | null {
  const prefix = `/orgs/${orgSlug}/projects/`
  if (!pathname.startsWith(prefix)) return null
  const rest = pathname.slice(prefix.length)
  const slug = rest.split("/")[0]
  return slug.length > 0 ? slug : null
}

type NavItemProps =
  | {
      to: "/"
      icon: LucideIcon
      label: string
      exact?: boolean
      params?: undefined
    }
  | {
      to: "/orgs/$orgSlug/projects"
      params: { orgSlug: string }
      icon: LucideIcon
      label: string
      exact?: boolean
    }
  | {
      to: "/orgs/$orgSlug"
      params: { orgSlug: string }
      icon: LucideIcon
      label: string
      exact?: boolean
    }

function NavItem({ to, params, icon: Icon, label, exact }: NavItemProps) {
  const base =
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors"
  return (
    <Link
      to={to}
      params={params as never}
      activeOptions={{ exact: exact ?? false }}
      className={base}
      inactiveProps={{
        className:
          "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      }}
      activeProps={{
        className: "bg-accent text-foreground font-medium"
      }}
    >
      <Icon className="size-4" strokeWidth={1.75} />
      <span>{label}</span>
    </Link>
  )
}

function Topbar({ user }: { user: User }) {
  return (
    <header className="flex h-14 items-center gap-2 px-4">
      <MobileNav user={user} />
      <div className="min-w-0 flex-1">
        <Breadcrumbs />
      </div>
      {user.activeOrgSlug ? (
        <RunningTimerIndicator orgSlug={user.activeOrgSlug} />
      ) : null}
      <UserMenu user={user} />
    </header>
  )
}

function MobileNav({ user }: { user: User }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const skipNextAutoClose = useRef(false)
  const suppressAutoClose = useCallback(() => {
    skipNextAutoClose.current = true
  }, [])

  useEffect(() => {
    if (skipNextAutoClose.current) {
      skipNextAutoClose.current = false
      return
    }
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)")
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <button
            type="button"
            aria-label={m.chrome_nav_open()}
            className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors transition-transform duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring active:scale-[0.97] lg:hidden"
          >
            <Menu className="size-5" strokeWidth={1.75} />
          </button>
        }
      />
      <SheetContent side="left" showCloseButton={false}>
        <SheetTitle className="sr-only">{m.chrome_nav_menu_title()}</SheetTitle>
        <SidebarDrawerAutoCloseProvider value={suppressAutoClose}>
          <LayoutGroup id="sidebar-drawer">
            <SidebarContent user={user} />
          </LayoutGroup>
        </SidebarDrawerAutoCloseProvider>
      </SheetContent>
    </Sheet>
  )
}

function UserMenu({ user }: { user: User }) {
  const logout = useAtomSet(logoutAtom)
  const initial = (user.name?.charAt(0) ?? user.email.charAt(0)).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={m.chrome_user_menu_open()}
            className="rounded-full outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Avatar className="size-9">
              {user.image ? <AvatarImage src={user.image} alt="" /> : null}
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-64">
        <div className="flex items-center gap-3 p-2">
          <Avatar className="size-10">
            {user.image ? <AvatarImage src={user.image} alt="" /> : null}
            <AvatarFallback>{initial}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user.email}
            </div>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <Link to="/profile" className="cursor-pointer">
              <UserRound className="size-4" strokeWidth={1.75} />
              {m.chrome_user_menu_profile()}
            </Link>
          }
        />
        {user.activeOrgSlug ? (
          <DropdownMenuItem
            render={
              <Link
                to="/orgs/$orgSlug/settings"
                params={{ orgSlug: user.activeOrgSlug }}
                className="cursor-pointer"
              >
                <Settings className="size-4" strokeWidth={1.75} />
                {m.org_settings_menu_item()}
              </Link>
            }
          />
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => logout()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" strokeWidth={1.75} />
          {m.chrome_user_menu_sign_out()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

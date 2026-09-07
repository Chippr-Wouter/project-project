import * as Result from "effect/unstable/reactivity/AsyncResult"
// Breadcrumbs aggregated from active route matches.
//
// PATTERN
// ----------------------------------------------------------------------------
// Each route's `loader` (or `staticData`) returns a `crumb` value. We walk the
// matches via `useMatches()` and render in order. Two crumb shapes:
//
//   - `static`  — a literal `{ label, to?, params? }`. For pages whose name
//                 is fixed (Dashboard, Projects, Profile).
//   - `project` / `ticket` — a tagged descriptor with the params we need. The
//                 component looks up the same atom the page uses, so the label
//                 stays reactive (renames update the crumb instantly) and we
//                 don't double-fetch alongside the page's own data.
//
// Routes can return EITHER a single crumb OR an array — the ticket route
// returns `[{project}, {ticket}]` so navigating directly to a ticket URL
// still renders the project crumb above it.

import { useAtomValue } from "@effect/atom-react"
import { Link, useMatches } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import { Fragment } from "react"
import { projectAtom, projectKey } from "@/atoms/projects"
import { sprintAtom, sprintKey } from "@/atoms/sprints"
import { ticketAtom, ticketKey } from "@/atoms/tickets"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import type { GroupId, TicketId } from "@projectproject/shared"

export type Crumb =
  | {
      type: "static"
      label: string
      to?: string
      params?: Record<string, string>
    }
  | { type: "project"; orgSlug: string; slug: string }
  | { type: "ticket"; orgSlug: string; slug: string; id: TicketId }
  | { type: "sprint"; orgSlug: string; slug: string; groupId: GroupId }

export type CrumbData = Crumb | ReadonlyArray<Crumb>

// Loader-data shape. `loaderData` is `unknown` from the router's perspective;
// we narrow at the read site.
type WithCrumb = { crumb?: CrumbData }

function flatten(crumbs: ReadonlyArray<CrumbData | undefined>): Crumb[] {
  const out: Crumb[] = []
  for (const c of crumbs) {
    if (!c) continue
    if (Array.isArray(c)) out.push(...c)
    else out.push(c as Crumb)
  }
  return out
}

export function Breadcrumbs({ className }: { className?: string }) {
  const matches = useMatches()
  const raw = matches.map((m) => (m.loaderData as WithCrumb | undefined)?.crumb)
  const crumbs = flatten(raw)

  if (crumbs.length === 0) return null

  return (
    <nav
      aria-label={m.nav_breadcrumb_label()}
      className={cn(
        "flex min-w-0 items-center gap-1 text-sm text-muted-foreground",
        className
      )}
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1
        return (
          <Fragment key={crumbKey(c, i)}>
            {i > 0 && (
              <ChevronRight
                className="size-3.5 shrink-0 text-muted-foreground/60"
                strokeWidth={1.75}
                aria-hidden
              />
            )}
            <CrumbItem crumb={c} isLast={isLast} />
          </Fragment>
        )
      })}
    </nav>
  )
}

function crumbKey(c: Crumb, i: number) {
  if (c.type === "static") return `s-${i}-${c.label}`
  if (c.type === "project") return `p-${c.orgSlug}-${c.slug}`
  if (c.type === "sprint") return `g-${c.orgSlug}-${c.slug}-${c.groupId}`
  return `t-${c.orgSlug}-${c.slug}-${c.id}`
}

function CrumbItem({ crumb, isLast }: { crumb: Crumb; isLast: boolean }) {
  switch (crumb.type) {
    case "static":
      return (
        <CrumbText to={crumb.to} params={crumb.params} isLast={isLast}>
          {crumb.label}
        </CrumbText>
      )
    case "project":
      return (
        <ProjectCrumb
          orgSlug={crumb.orgSlug}
          slug={crumb.slug}
          isLast={isLast}
        />
      )
    case "ticket":
      return (
        <TicketCrumb
          orgSlug={crumb.orgSlug}
          slug={crumb.slug}
          id={crumb.id}
          isLast={isLast}
        />
      )
    case "sprint":
      return (
        <SprintCrumb
          orgSlug={crumb.orgSlug}
          slug={crumb.slug}
          groupId={crumb.groupId}
          isLast={isLast}
        />
      )
  }
}

function SprintCrumb({
  orgSlug,
  slug,
  groupId,
  isLast
}: {
  orgSlug: string
  slug: string
  groupId: GroupId
  isLast: boolean
}) {
  const result = useAtomValue(sprintAtom(sprintKey(orgSlug, slug, groupId)))
  if (!Result.isSuccess(result)) {
    return (
      <span
        className="skeleton inline-block h-4 rounded bg-muted/60 align-middle"
        style={{ width: `${Math.max(groupId.length, 4)}ch` }}
        aria-label={m.nav_crumb_loading({ slug: groupId })}
      />
    )
  }
  return (
    <CrumbText
      to="/orgs/$orgSlug/projects/$slug/sprints/$groupId"
      params={{ orgSlug, slug, groupId }}
      isLast={isLast}
    >
      {result.value.name}
    </CrumbText>
  )
}

function ProjectCrumb({
  orgSlug,
  slug,
  isLast
}: {
  orgSlug: string
  slug: string
  isLast: boolean
}) {
  const result = useAtomValue(projectAtom(projectKey(orgSlug, slug)))
  if (!Result.isSuccess(result)) {
    return (
      <span
        className="skeleton inline-block h-4 rounded bg-muted/60 align-middle"
        style={{ width: `${Math.max(slug.length, 4)}ch` }}
        aria-label={m.nav_crumb_loading({ slug })}
      />
    )
  }
  return (
    <CrumbText
      to="/orgs/$orgSlug/projects/$slug"
      params={{ orgSlug, slug }}
      isLast={isLast}
    >
      {result.value.name}
    </CrumbText>
  )
}

function TicketCrumb({
  orgSlug,
  slug,
  id,
  isLast
}: {
  orgSlug: string
  slug: string
  id: TicketId
  isLast: boolean
}) {
  const result = useAtomValue(ticketAtom(ticketKey(orgSlug, slug, id)))
  const label = Result.isSuccess(result) ? result.value.title : id
  return (
    <CrumbText
      to="/orgs/$orgSlug/projects/$slug"
      params={{ orgSlug, slug }}
      isLast={isLast}
    >
      <span className="font-mono text-xs">{id}</span>{" "}
      <span className={Result.isSuccess(result) ? "" : "italic opacity-60"}>
        {Result.isSuccess(result) ? label : m.nav_crumb_loading_placeholder()}
      </span>
    </CrumbText>
  )
}

function CrumbText({
  to,
  params,
  isLast,
  children
}: {
  to?: string
  params?: Record<string, string>
  isLast: boolean
  children: React.ReactNode
}) {
  const className = cn(
    "max-w-[20ch] truncate",
    isLast ? "text-foreground" : "hover:text-foreground transition-colors"
  )
  if (isLast || !to) {
    return (
      <span aria-current={isLast ? "page" : undefined} className={className}>
        {children}
      </span>
    )
  }
  return (
    <Link to={to} params={params as never} className={className}>
      {children}
    </Link>
  )
}

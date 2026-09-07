import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link, useMatches } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion
} from "motion/react"
import { MoreHorizontal, SlidersHorizontal } from "lucide-react"
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react"
import { projectKey, updateProjectAtom } from "@/atoms/projects"
import {
  projectKey as sprintsProjectKey,
  sprintsListAtom
} from "@/atoms/sprints"
import { ActiveSprintLine } from "@/components/sprints/ActiveSprintLine"
import {
  SprintDeleteMenu,
  SprintNameField,
  SprintStatusSelect,
  SprintSubtitle
} from "@/components/sprints/SprintHeaderFields"
import { GithubChip } from "@/components/GithubChip"
import { ProjectIdentityEditor } from "@/components/ProjectIdentityEditor"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { useProjectRole } from "@/lib/projectRole"
import { springs, transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import type { ProjectDetail as ProjectDetailType } from "@projectproject/shared"

const morphFrom = { opacity: 0, filter: "blur(4px)" }
const morphTo = { opacity: 1, filter: "blur(0px)" }

function MorphSlot({
  slotKey,
  layoutId,
  reduce,
  className,
  children
}: {
  slotKey: string
  layoutId?: string
  reduce: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={slotKey}
        layout={layoutId ? "position" : undefined}
        layoutId={layoutId}
        initial={reduce ? false : morphFrom}
        animate={morphTo}
        exit={reduce ? { opacity: 0 } : morphFrom}
        transition={
          layoutId
            ? {
                layout: springs.moderate,
                opacity: transitions.presence,
                filter: transitions.presence
              }
            : transitions.presence
        }
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

export function ProjectHeader({
  orgSlug,
  slug,
  name,
  project
}: {
  orgSlug: string
  slug: string
  name: string
  project: ProjectDetailType
}) {
  const { role: myRole } = useProjectRole()
  const canEdit = myRole === "owner" || myRole === "admin"
  const reduce = useReducedMotion() ?? false

  const matches = useMatches()
  const sprintMatch = matches.find(
    (mt) =>
      mt.routeId === "/_authed/orgs/$orgSlug/projects/$slug/sprints/$groupId"
  )
  const sprintGroupId = sprintMatch
    ? (sprintMatch.params as { groupId: string }).groupId
    : null

  const sprintsResult = useAtomValue(
    sprintsListAtom(sprintsProjectKey(orgSlug, slug))
  )
  const sprintsLoaded = Result.isSuccess(sprintsResult)
  const sprints = sprintsLoaded ? sprintsResult.value : []
  const sprint = sprintGroupId
    ? sprints.find((s) => s.id === sprintGroupId)
    : undefined
  const sprintMissing = sprintGroupId != null && sprintsLoaded && !sprint

  const mode = sprintGroupId ? `sprint:${sprintGroupId}` : "project"
  const isCompleted = sprint?.completedAt != null

  return (
    <LayoutGroup id={`project-header-${slug}`}>
      <header className="flex items-start gap-3">
        <MorphSlot
          slotKey={mode}
          layoutId="project-header-icon"
          reduce={reduce}
        >
          {sprintGroupId ? (
            sprint ? (
              <SprintStatusSelect
                orgSlug={orgSlug}
                slug={slug}
                sprint={sprint}
                sprints={sprints}
              />
            ) : sprintMissing ? (
              <div className="-mt-1 size-10 shrink-0 rounded-lg bg-muted/40" />
            ) : (
              <div className="-mt-1 size-10 shrink-0 animate-pulse rounded-lg bg-muted" />
            )
          ) : (
            <ProjectIdentityEditor
              orgSlug={orgSlug}
              slug={slug}
              icon={project.icon}
              color={project.color}
              canEdit={canEdit}
              size="header"
            />
          )}
        </MorphSlot>

        <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <MorphSlot
            slotKey={mode}
            layoutId="project-header-title"
            reduce={reduce}
            className="flex h-8 min-w-0 max-w-full items-center"
          >
            {sprintGroupId ? (
              sprint ? (
                <SprintNameField
                  orgSlug={orgSlug}
                  slug={slug}
                  sprint={sprint}
                  disabled={isCompleted}
                />
              ) : sprintMissing ? (
                <span className="truncate text-2xl font-semibold tracking-tight text-muted-foreground">
                  {m.sprints_not_found_title()}
                </span>
              ) : (
                <div className="h-6 w-40 animate-pulse rounded bg-muted/60" />
              )
            ) : (
              <NameField
                orgSlug={orgSlug}
                slug={slug}
                name={name}
                canEdit={canEdit}
              />
            )}
          </MorphSlot>
          <MorphSlot
            slotKey={mode}
            layoutId="project-header-subtitle"
            reduce={reduce}
            className="flex h-5 items-center"
          >
            {sprintGroupId ? (
              sprint ? (
                <SprintSubtitle
                  orgSlug={orgSlug}
                  slug={slug}
                  sprint={sprint}
                  disabled={isCompleted}
                />
              ) : sprintMissing ? null : (
                <div className="h-3.5 w-28 animate-pulse rounded bg-muted/60" />
              )
            ) : (
              <ActiveSprintLine orgSlug={orgSlug} slug={slug} />
            )}
          </MorphSlot>
        </div>

        <MorphSlot slotKey={mode} reduce={reduce}>
          {sprintGroupId ? (
            sprint ? (
              <SprintDeleteMenu
                orgSlug={orgSlug}
                slug={slug}
                sprint={sprint}
                sprints={sprints}
              />
            ) : sprintMissing ? null : (
              <div className="size-8" />
            )
          ) : (
            <div className="flex items-center gap-3">
              <GithubChip
                orgSlug={orgSlug}
                slug={slug}
                github={project.github}
                callerRole={myRole}
              />
              <ProjectMenu orgSlug={orgSlug} slug={slug} />
            </div>
          )}
        </MorphSlot>
      </header>
    </LayoutGroup>
  )
}

function NameField({
  orgSlug,
  slug,
  name,
  canEdit
}: {
  orgSlug: string
  slug: string
  name: string
  canEdit: boolean
}) {
  const pKey = projectKey(orgSlug, slug)
  const update = useAtomSet(updateProjectAtom(pKey), { mode: "promiseExit" })
  const updateState = useAtomValue(updateProjectAtom(pKey))
  const saving = updateState.waiting
  const failed = Result.isFailure(updateState)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)

  useEffect(() => {
    if (!editing) setDraft(name)
  }, [editing, name])

  async function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === name) {
      setEditing(false)
      setDraft(name)
      return
    }
    const exit = await update({ name: trimmed })
    if (Exit.isSuccess(exit)) setEditing(false)
  }

  function handleKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault()
      void commit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      setDraft(name)
      setEditing(false)
    }
  }

  if (!canEdit || !editing) {
    return (
      <button
        type="button"
        onClick={() => canEdit && setEditing(true)}
        disabled={!canEdit}
        className={cn(
          "-mx-1 truncate rounded px-1 text-left text-2xl font-semibold tracking-tight transition-colors transition-transform duration-100 active:scale-[0.97]",
          canEdit && "hover:bg-accent/40"
        )}
      >
        {name}
      </button>
    )
  }
  return (
    <div className="relative w-full">
      <input
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={handleKey}
        className="-mx-1 w-full rounded bg-transparent px-1 text-2xl font-semibold tracking-tight outline-none ring-2 ring-ring/50"
        maxLength={120}
        aria-label={m.project_detail_name_aria_label()}
      />
      {failed && (
        <p
          role="alert"
          className="absolute top-full left-0 mt-1 text-xs text-destructive"
        >
          {m.project_detail_name_error()}
        </p>
      )}
    </div>
  )
}

function ProjectMenu({ orgSlug, slug }: { orgSlug: string; slug: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={m.project_detail_actions_aria_label()}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors transition-transform duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={6} className="w-44">
        <DropdownMenuItem
          render={
            <Link
              to="/orgs/$orgSlug/projects/$slug/settings"
              params={{ orgSlug, slug }}
            />
          }
        >
          <SlidersHorizontal className="size-4" strokeWidth={1.75} />
          {m.project_detail_tab_settings()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute, Link } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { useRef, useState, type FormEvent } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ChevronRight, FolderKanban, Plus } from "lucide-react"
import type { Project } from "@projectproject/shared"
import { createProjectAtom, projectsListAtom } from "@/atoms/projects"
import { ProjectTile } from "@/components/ProjectTile"
import { Kbd } from "@/components/ui/kbd"
import { PageContainer, PageHeader } from "@/components/page"
import { errorMessage, type AppError } from "@/lib/errorMessage"
import { transitions } from "@/lib/springs"
import { slugify } from "@/lib/slug"
import { cn } from "@/lib/utils"
import { formatRelative } from "@/lib/relative-time"
import { useGlobalShortcut } from "@/lib/use-global-shortcut"
import { m } from "@/paraglide/messages"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/projects/")({
  component: Projects,
  loader: ({ params }) => ({
    crumb: {
      type: "static" as const,
      label: "Projects",
      to: "/orgs/$orgSlug/projects",
      params: { orgSlug: params.orgSlug }
    }
  })
})

function Projects() {
  const { orgSlug } = Route.useParams()
  const list = useAtomValue(projectsListAtom(orgSlug))
  const [creating, setCreating] = useState(false)

  const content = Result.matchWithError(list, {
    onInitial: () => <ListSkeleton />,
    onError: (error) => (
      <>
        <CreateRow orgSlug={orgSlug} onFocusChange={setCreating} />
        <ListMessage>
          {m.projects_list_load_error({ tag: error._tag })}
        </ListMessage>
      </>
    ),
    onDefect: (defect) => (
      <>
        <CreateRow orgSlug={orgSlug} onFocusChange={setCreating} />
        <ListMessage>
          {m.projects_list_defect({ defect: String(defect) })}
        </ListMessage>
      </>
    ),
    onSuccess: ({ value }) => (
      <>
        <CreateRow orgSlug={orgSlug} onFocusChange={setCreating} />
        <motion.div
          animate={{ opacity: creating ? 0.35 : 1 }}
          transition={transitions.presence}
        >
          {value.length === 0 ? (
            <EmptyProjects />
          ) : (
            <ul className="flex flex-col gap-2">
              {value.map((project) => (
                <li key={project.slug}>
                  <ProjectRow orgSlug={orgSlug} project={project} />
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      </>
    )
  })

  return (
    <PageContainer>
      <PageHeader>
        <h1>{m.projects_page_title()}</h1>
        <p>{m.projects_page_subtitle()}</p>
      </PageHeader>

      {content}
    </PageContainer>
  )
}

function CreateRow({
  orgSlug,
  onFocusChange
}: {
  orgSlug: string
  onFocusChange?: (focused: boolean) => void
}) {
  const create = useAtomSet(createProjectAtom(orgSlug), {
    mode: "promiseExit"
  })
  const resetCreate = useAtomSet(createProjectAtom(orgSlug))
  const createState = useAtomValue(createProjectAtom(orgSlug))
  const submitting = createState.waiting
  const error = Result.matchWithError(createState, {
    onInitial: () => null,
    onSuccess: () => null,
    onError: (err) => errorMessage(err as AppError),
    onDefect: () => m.projects_create_error_fallback()
  })
  const [name, setName] = useState("")
  const [keyOverride, setKeyOverride] = useState("")
  const [keyTouched, setKeyTouched] = useState(false)
  const [focused, setFocused] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reduceMotion = useReducedMotion()
  useGlobalShortcut("c", inputRef)
  const trimmed = name.trim()
  const previewSlug = trimmed ? slugify(trimmed) : ""
  const derivedKey = deriveKey(trimmed)
  const effectiveKey = keyTouched ? keyOverride : derivedKey
  const canSubmit = Boolean(
    trimmed && /^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey)
  )

  function trackFocus(next: boolean) {
    setFocused(next)
    onFocusChange?.(next)
  }

  function handleKeyChange(value: string) {
    resetCreate(Atom.Reset)
    const sanitized = value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 10)
    setKeyOverride(sanitized)
    setKeyTouched(true)
  }

  function handleNameChange(value: string) {
    resetCreate(Atom.Reset)
    setName(value)
    if (!value.trim()) {
      setKeyOverride("")
      setKeyTouched(false)
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit || submitting) return
    const exit = await create({ name: trimmed, key: effectiveKey })
    if (Exit.isSuccess(exit)) {
      const activeElement = document.activeElement
      if (
        activeElement instanceof HTMLElement &&
        formRef.current?.contains(activeElement)
      ) {
        activeElement.blur()
      }
      setName("")
      setKeyOverride("")
      setKeyTouched(false)
      trackFocus(false)
    } else {
      if (!formRef.current?.contains(document.activeElement)) {
        inputRef.current?.focus()
      }
    }
  }

  return (
    <form ref={formRef} onSubmit={onSubmit}>
      <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>
        {m.projects_create_name_aria_label()}
      </button>
      <div
        className={cn(
          "relative rounded-xl border border-border bg-background transition-[color,box-shadow]",
          "ring-offset-background focus-within:ring-2 focus-within:ring-ring"
        )}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement
          if (
            target.closest(
              "button, [role='button'], a, input, textarea, select, [contenteditable='true']"
            )
          )
            return
          const input = inputRef.current
          if (!input || input === document.activeElement) return
          e.preventDefault()
          input.focus()
        }}
      >
        <div className="flex w-full cursor-text items-center px-3 py-1.5">
          <div className="mr-2 grid size-6 shrink-0 place-items-center text-muted-foreground">
            <Plus className="size-4" strokeWidth={1.75} />
          </div>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            onFocus={() => trackFocus(true)}
            onBlur={() => trackFocus(false)}
            placeholder={m.projects_create_name_placeholder()}
            aria-label={m.projects_create_name_aria_label()}
            readOnly={submitting}
            aria-disabled={submitting}
            maxLength={120}
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground read-only:cursor-wait"
          />
          <AnimatePresence initial={false}>
            {trimmed && (
              <motion.div
                key="key-cluster"
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                transition={transitions.fade}
                className="flex shrink-0 items-center"
              >
                <div className="mx-3 h-5 w-px bg-border" />
                <input
                  value={effectiveKey}
                  onChange={(e) => handleKeyChange(e.target.value)}
                  onFocus={() => trackFocus(true)}
                  onBlur={() => trackFocus(false)}
                  placeholder={m.projects_create_key_placeholder()}
                  aria-label={m.projects_create_key_aria_label()}
                  readOnly={submitting}
                  aria-disabled={submitting}
                  maxLength={10}
                  style={{ width: "calc(4ch + 0.5rem)" }}
                  className="shrink-0 bg-transparent pr-2 font-mono text-sm uppercase tabular-nums text-foreground outline-none placeholder:text-muted-foreground read-only:cursor-wait"
                />
              </motion.div>
            )}
          </AnimatePresence>
          {!focused && !trimmed && !error && (
            <span className="ml-2 shrink-0">
              <Kbd>c</Kbd>
            </span>
          )}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {trimmed && (
          <motion.div
            key="hint"
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={transitions.presence}
            className="overflow-hidden"
          >
            <div className="mt-2 flex items-center gap-3 pl-3">
              <div className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <span className="text-muted-foreground/60">→</span>
                {effectiveKey && (
                  <>
                    <span>{effectiveKey}-1</span>
                    <span className="text-muted-foreground/60">·</span>
                  </>
                )}
                <span className="truncate">/{previewSlug}</span>
              </div>
              {error && (
                <span
                  role="alert"
                  className="ml-auto shrink-0 text-xs text-destructive"
                >
                  {error}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  )
}

function deriveKey(name: string): string {
  const cleaned = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .trim()
  if (!cleaned) return ""
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ""
  const candidate =
    words.length >= 2
      ? words
          .slice(0, 6)
          .map((w) => w[0])
          .join("")
      : words[0].slice(0, 4)
  return candidate.replace(/^[0-9]+/, "").slice(0, 10)
}

function ProjectRow({
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
        "group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 transition-colors",
        "hover:bg-accent/40 hover:border-border/80"
      )}
    >
      <ProjectTile
        icon={project.icon}
        color={project.color}
        size="sm"
        seed={project.slug}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{project.name}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {project.key} /{project.slug}
        </div>
      </div>
      <div className="hidden shrink-0 text-xs text-muted-foreground sm:block">
        {formatRelative(project.createdAt)}
      </div>
      <ChevronRight
        className="size-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
        strokeWidth={1.75}
      />
    </Link>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[60px] skeleton rounded-xl border border-border bg-background"
        />
      ))}
    </div>
  )
}

function ListMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function EmptyProjects() {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/50 px-4 py-10 text-center">
      <div className="grid size-10 place-items-center rounded-lg bg-muted text-muted-foreground">
        <FolderKanban className="size-5" strokeWidth={1.75} />
      </div>
      <div className="text-sm font-medium">{m.projects_list_empty()}</div>
      <p className="max-w-xs text-xs text-muted-foreground">
        {m.projects_list_empty_body()}
      </p>
    </div>
  )
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { lazy, Suspense, useEffect, useState, type FormEvent } from "react"
import {
  deleteProjectAtom,
  projectKey,
  updateProjectAtom
} from "@/atoms/projects"
import { LexicalEditor, type SaveStatus } from "@/components/LexicalEditor"
import { MarkdownSaveIndicator } from "@/components/MarkdownSaveIndicator"
import { Markdown } from "@/components/Markdown"
import { ProjectIdentityEditor } from "@/components/ProjectIdentityEditor"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useProjectRole } from "@/lib/projectRole"
import { m } from "@/paraglide/messages"
import { useProject } from "../-context"

const BannerSettings = lazy(() => import("@/components/ProjectBannerSettings"))

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/settings/general"
)({
  component: GeneralSettings,
  loader: () => ({
    crumb: { type: "static" as const, label: m.project_settings_general_tab() }
  })
})

function GeneralSettings() {
  const { orgSlug } = Route.useParams()
  const project = useProject()
  const key = projectKey(orgSlug, project.slug)
  const update = useAtomSet(updateProjectAtom(key), { mode: "promiseExit" })
  const updateState = useAtomValue(updateProjectAtom(key))
  const remove = useAtomSet(deleteProjectAtom(key), { mode: "promiseExit" })
  const removeState = useAtomValue(deleteProjectAtom(key))
  const navigate = useNavigate()
  const { role } = useProjectRole()
  const canEdit = role === "owner" || role === "admin"
  const [name, setName] = useState(project.name)
  const [status, setStatus] = useState<SaveStatus>("idle")

  useEffect(() => setName(project.name), [project.name])

  async function onNameSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === project.name || !canEdit) return
    await update({ name: trimmed })
  }

  async function onDelete() {
    const exit = await remove()
    if (Exit.isSuccess(exit)) {
      void navigate({ to: "/orgs/$orgSlug/projects", params: { orgSlug } })
    }
  }

  const bannerEnabled = canEdit

  return (
    <div className="flex w-full flex-col gap-8">
      <section className="flex flex-col gap-4">
        {bannerEnabled ? (
          <div className="flex flex-col gap-3">
            <span className="text-sm font-medium">
              {m.project_settings_appearance_label()}
            </span>
            <div className="flex flex-col gap-x-6 gap-y-4 sm:flex-row sm:items-start">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">
                  {m.project_settings_identity_label()}
                </span>
                <ProjectIdentityEditor
                  orgSlug={orgSlug}
                  slug={project.slug}
                  icon={project.icon}
                  color={project.color}
                  canEdit={canEdit}
                  size="settings"
                />
              </div>
              <Suspense fallback={null}>
                <BannerSettings
                  key={key}
                  orgSlug={orgSlug}
                  slug={project.slug}
                  banner={project.banner}
                />
              </Suspense>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <span className="text-sm font-medium">
              {m.project_settings_identity_label()}
            </span>
            <ProjectIdentityEditor
              orgSlug={orgSlug}
              slug={project.slug}
              icon={project.icon}
              color={project.color}
              canEdit={canEdit}
              size="settings"
            />
          </div>
        )}
        <form onSubmit={onNameSubmit} className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="project-name">
            {m.project_settings_name_label()}
          </label>
          <div className="flex gap-2">
            <Input
              id="project-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canEdit || updateState.waiting}
              maxLength={120}
            />
            {canEdit ? (
              <Button
                type="submit"
                variant="secondary"
                disabled={updateState.waiting || name.trim() === project.name}
              >
                {m.project_settings_save_button()}
              </Button>
            ) : null}
          </div>
        </form>
        <div className="grid gap-2">
          <span className="text-sm font-medium">
            {m.project_settings_key_label()}
          </span>
          <span className="w-fit rounded-md border border-border bg-background px-2 py-1 font-mono text-sm">
            {project.key}
          </span>
        </div>
      </section>

      <section className="grid gap-2">
        <span className="text-sm font-medium">
          {m.project_settings_description_heading()}
        </span>
        {canEdit ? (
          <>
            <LexicalEditor
              key={project.slug}
              markdown={project.body}
              onChange={async (next) => {
                await update({ body: next })
              }}
              onStatusChange={setStatus}
              className="rounded-lg border border-border bg-background px-3 py-2"
            />
            <MarkdownSaveIndicator
              status={status}
              className="justify-self-end"
            />
          </>
        ) : (
          <Markdown>{project.body}</Markdown>
        )}
      </section>

      {role === "owner" ? (
        <section className="flex items-center justify-between gap-4 border-t border-border pt-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-destructive">
              {m.project_settings_delete_heading()}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {m.project_settings_delete_description()}
            </p>
          </div>
          <Button
            type="button"
            variant="tertiary"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            disabled={removeState.waiting}
            onClick={() => void onDelete()}
          >
            {Result.isInitial(removeState) || !removeState.waiting
              ? m.project_detail_delete_button()
              : m.project_detail_delete_in_progress()}
          </Button>
        </section>
      ) : null}
    </div>
  )
}

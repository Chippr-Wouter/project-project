import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link, createFileRoute } from "@tanstack/react-router"
import {
  connectEverhourProjectAtom,
  disconnectEverhourProjectAtom,
  everhourProjectStatusAtom,
  syncEverhourProjectAtom
} from "@/atoms/everhour"
import { meAtom } from "@/atoms/auth"
import { projectKey, updateProjectSetupAtom } from "@/atoms/projects"
import { ErrorPage } from "@/components/ErrorPage"
import { GithubChip } from "@/components/GithubChip"
import { FigmaProjectSettings } from "@/components/settings/FigmaProjectSettings"
import { EverhourApiKeyWalkthrough } from "@/components/time/EverhourApiKeyWalkthrough"
import { Button } from "@/components/ui/button"
import { type AppError, errorMessage } from "@/lib/errorMessage"
import { useProjectRole } from "@/lib/projectRole"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"
import { useProject } from "../-context"

export const Route = createFileRoute(
  "/_authed/orgs/$orgSlug/projects/$slug/settings/integrations"
)({
  component: IntegrationsSettings,
  loader: () => ({
    crumb: {
      type: "static" as const,
      label: m.project_settings_integrations_tab()
    }
  })
})

function IntegrationsSettings() {
  const { orgSlug } = Route.useParams()
  const project = useProject()
  const key = projectKey(orgSlug, project.slug)
  const update = useAtomSet(updateProjectSetupAtom(key))
  const { role } = useProjectRole()

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background px-4 py-3">
        <div>
          <p className="text-sm font-medium">
            {m.project_settings_github_heading()}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {project.github
              ? m.project_settings_github_connected()
              : m.project_settings_github_not_connected()}
          </p>
        </div>
        <GithubChip
          orgSlug={orgSlug}
          slug={project.slug}
          github={project.github}
          callerRole={role}
        />
      </div>
      {project.setup.connectGithubDismissedAt ? (
        <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {m.project_setup_github_dismissed_note()}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ connectGithubDismissedAt: null })}
          >
            {m.project_setup_restore_button()}
          </Button>
        </div>
      ) : null}
      <EverhourSettingsCard orgSlug={orgSlug} slug={project.slug} role={role} />
      <FigmaProjectSettings
        orgSlug={orgSlug}
        slug={project.slug}
        canManage={role === "owner" || role === "admin"}
      />
    </section>
  )
}

function EverhourSettingsCard({
  orgSlug,
  slug,
  role
}: {
  orgSlug: string
  slug: string
  role: "owner" | "admin" | "member"
}) {
  const key = projectKey(orgSlug, slug)
  const status = useAtomValue(everhourProjectStatusAtom(key))
  const me = useAtomValue(meAtom)

  return Result.matchWithError(status, {
    onInitial: () => (
      <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
        {m.project_settings_everhour_loading()}
      </div>
    ),
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value, waiting }) => {
      const user = Result.isSuccess(me) ? me.value : null
      const hasKey = user?.personalEverhour.connected === true
      const canManage = role === "owner" || role === "admin"
      return (
        <EverhourSettingsContent
          orgSlug={orgSlug}
          slug={slug}
          status={value}
          waiting={waiting}
          hasKey={hasKey}
          canManage={canManage}
        />
      )
    }
  })
}

function EverhourSettingsContent({
  orgSlug,
  slug,
  status,
  waiting,
  hasKey,
  canManage
}: {
  orgSlug: string
  slug: string
  status: {
    status: "not_connected" | "active" | "broken"
    everhourProjectId: string | null
    everhourProjectName: string | null
    lastSyncedAt: Date | null
    lastSyncStatus: "ok" | "error" | null
    lastSyncError: string | null
    needsSync: boolean
  }
  waiting: boolean
  hasKey: boolean
  canManage: boolean
}) {
  const key = projectKey(orgSlug, slug)
  const connect = useAtomSet(connectEverhourProjectAtom(key), {
    mode: "promise"
  })
  const sync = useAtomSet(syncEverhourProjectAtom(key), { mode: "promise" })
  const disconnect = useAtomSet(disconnectEverhourProjectAtom(key), {
    mode: "promise"
  })
  const connectState = useAtomValue(connectEverhourProjectAtom(key))
  const syncState = useAtomValue(syncEverhourProjectAtom(key))
  const disconnectState = useAtomValue(disconnectEverhourProjectAtom(key))
  const busy =
    waiting ||
    connectState.waiting ||
    syncState.waiting ||
    disconnectState.waiting
  const mutationError =
    Result.matchWithError(connectState, {
      onInitial: () => null,
      onSuccess: () => null,
      onError: (err) => errorMessage(err as AppError),
      onDefect: () => m.project_settings_everhour_action_error()
    }) ??
    Result.matchWithError(syncState, {
      onInitial: () => null,
      onSuccess: () => null,
      onError: (err) => errorMessage(err as AppError),
      onDefect: () => m.project_settings_everhour_action_error()
    }) ??
    Result.matchWithError(disconnectState, {
      onInitial: () => null,
      onSuccess: () => null,
      onError: (err) => errorMessage(err as AppError),
      onDefect: () => m.project_settings_everhour_action_error()
    })
  const error =
    status.lastSyncStatus === "ok"
      ? null
      : (status.lastSyncError ?? mutationError)

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className={busy ? "min-w-0 animate-pulse" : "min-w-0"}>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-medium">
              {m.project_settings_everhour_heading()}
            </p>
            <EverhourApiKeyWalkthrough />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.status === "active"
              ? m.project_settings_everhour_connected()
              : status.status === "broken"
                ? m.project_settings_everhour_broken()
                : m.project_settings_everhour_not_connected()}
          </p>
          {status.everhourProjectId ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {status.everhourProjectName} · {status.everhourProjectId}
            </p>
          ) : null}
          {status.lastSyncedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {m.project_settings_everhour_last_synced({
                date: status.lastSyncedAt.toLocaleString(getLocale())
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {!hasKey ? (
            <Button variant="secondary" render={<Link to="/profile" />}>
              {m.project_settings_everhour_connect_profile_button()}
            </Button>
          ) : null}
          {canManage && hasKey && status.status === "not_connected" ? (
            <Button
              type="button"
              loading={connectState.waiting}
              disabled={busy}
              onClick={() => void connect()}
            >
              {m.project_settings_everhour_connect_button()}
            </Button>
          ) : null}
          {canManage && hasKey && status.status !== "not_connected" ? (
            <>
              <Button
                type="button"
                loading={syncState.waiting}
                disabled={busy}
                onClick={() => void sync()}
              >
                {m.project_settings_everhour_sync_button()}
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={disconnectState.waiting}
                disabled={busy}
                onClick={() => void disconnect()}
              >
                {m.project_settings_everhour_disconnect_button()}
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

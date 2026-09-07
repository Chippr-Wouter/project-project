import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { createFileRoute } from "@tanstack/react-router"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { useState, type FormEvent } from "react"
import { orgDetailAtom, orgKey } from "@/atoms/orgs"
import {
  connectStorageAtom,
  disconnectStorageAtom,
  orgStorageAtom
} from "@/atoms/storage"
import { ErrorPage } from "@/components/ErrorPage"
import { StorageCorsPanel } from "@/components/StorageCorsPanel"
import { Button } from "@/components/ui/button"
import { ConfirmButton, useConfirmButton } from "@/components/ui/confirm-button"
import { Input } from "@/components/ui/input"
import { type AppError, errorMessage } from "@/lib/errorMessage"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"

import type { OrgDetail, OrgStorageStatus } from "@projectproject/shared"

export const Route = createFileRoute("/_authed/orgs/$orgSlug/settings/storage")(
  {
    component: StorageSettings,
    loader: () => ({
      crumb: { type: "static" as const, label: m.storage_crumb() }
    })
  }
)

function StorageSettings() {
  const { orgSlug } = Route.useParams()
  const orgResult = useAtomValue(orgDetailAtom(orgSlug))
  const storageResult = useAtomValue(orgStorageAtom(orgSlug))

  return Result.matchWithError(orgResult, {
    onInitial: () => <StorageSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value: org }) =>
      Result.matchWithError(storageResult, {
        onInitial: () => <StorageSkeleton />,
        onError: (error) => <ErrorPage error={error} contained />,
        onDefect: (defect) => <ErrorPage error={defect} contained />,
        onSuccess: ({ value: status, waiting }) => (
          <StorageForm
            orgSlug={orgSlug}
            role={org.role}
            status={status}
            waiting={waiting}
          />
        )
      })
  })
}

function StorageForm({
  orgSlug,
  role,
  status,
  waiting
}: {
  orgSlug: string
  role: OrgDetail["role"]
  status: OrgStorageStatus
  waiting: boolean
}) {
  const canEdit = role === "owner" || role === "admin"

  if (!canEdit) {
    return (
      <div className="flex w-full flex-col gap-4">
        <StorageStatusRows status={status} waiting={waiting} />
        <p className="text-sm text-destructive">
          {m.storage_error_forbidden()}
        </p>
      </div>
    )
  }

  if (status.status === "not_connected") {
    return <StorageConnectForm orgSlug={orgSlug} waiting={waiting} />
  }

  return (
    <StorageConnectedPanel
      orgSlug={orgSlug}
      status={status}
      waiting={waiting}
    />
  )
}

function StorageNotConnectedPanel({ waiting }: { waiting: boolean }) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background px-4 py-3",
        waiting && "animate-pulse"
      )}
    >
      <p className="text-sm font-medium">{m.storage_not_connected()}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {m.storage_not_connected_hint()}
      </p>
    </div>
  )
}

function StorageConnectForm({
  orgSlug,
  waiting
}: {
  orgSlug: string
  waiting: boolean
}) {
  const key = orgKey(orgSlug)
  const connect = useAtomSet(connectStorageAtom(key), { mode: "promiseExit" })
  const connectState = useAtomValue(connectStorageAtom(key))

  const [endpoint, setEndpoint] = useState("")
  const [bucket, setBucket] = useState("")
  const [region, setRegion] = useState("auto")
  const [accessKeyId, setAccessKeyId] = useState("")
  const [secretAccessKey, setSecretAccessKey] = useState("")
  const [keyPrefix, setKeyPrefix] = useState("")
  const [forcePathStyle, setForcePathStyle] = useState(true)

  const submitting = connectState.waiting
  const error = Result.matchWithError(connectState, {
    onInitial: () => null,
    onSuccess: () => null,
    onError: (err) => errorMessage(err as AppError),
    onDefect: () => m.storage_error_fallback()
  })

  const canSubmit =
    endpoint.trim().length > 0 &&
    bucket.trim().length > 0 &&
    region.trim().length > 0 &&
    accessKeyId.trim().length > 0 &&
    secretAccessKey.trim().length > 0

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || submitting) return
    const exit = await connect({
      endpoint: endpoint.trim(),
      bucket: bucket.trim(),
      region: region.trim(),
      accessKeyId: accessKeyId.trim(),
      secretAccessKey,
      keyPrefix: keyPrefix.trim().length > 0 ? keyPrefix.trim() : null,
      forcePathStyle
    })
    if (Exit.isSuccess(exit)) setSecretAccessKey("")
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
      <StorageNotConnectedPanel waiting={waiting} />

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="storage-endpoint">
          {m.storage_endpoint_label()}
        </label>
        <Input
          id="storage-endpoint"
          value={endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
          placeholder={m.storage_endpoint_placeholder()}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="storage-bucket">
          {m.storage_bucket_label()}
        </label>
        <Input
          id="storage-bucket"
          value={bucket}
          onChange={(event) => setBucket(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="storage-region">
          {m.storage_region_label()}
        </label>
        <Input
          id="storage-region"
          value={region}
          onChange={(event) => setRegion(event.target.value)}
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          {m.storage_region_hint()}
        </p>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="storage-access-key">
          {m.storage_access_key_label()}
        </label>
        <Input
          id="storage-access-key"
          value={accessKeyId}
          onChange={(event) => setAccessKeyId(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="storage-secret-key">
          {m.storage_secret_key_label()}
        </label>
        <Input
          id="storage-secret-key"
          type="password"
          autoComplete="off"
          value={secretAccessKey}
          onChange={(event) => setSecretAccessKey(event.target.value)}
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          {m.storage_secret_key_hint()}
        </p>
      </div>

      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="storage-key-prefix">
          {m.storage_key_prefix_label()}
        </label>
        <Input
          id="storage-key-prefix"
          value={keyPrefix}
          onChange={(event) => setKeyPrefix(event.target.value)}
          disabled={submitting}
        />
        <p className="text-xs text-muted-foreground">
          {m.storage_key_prefix_hint()}
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 rounded border border-border"
          checked={forcePathStyle}
          onChange={(event) => setForcePathStyle(event.target.checked)}
          disabled={submitting}
        />
        {m.storage_force_path_style_label()}
      </label>

      <div>
        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? m.storage_connecting() : m.storage_connect_button()}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <StorageCorsPanel />
    </form>
  )
}

function StorageConnectedPanel({
  orgSlug,
  status,
  waiting
}: {
  orgSlug: string
  status: OrgStorageStatus
  waiting: boolean
}) {
  const key = orgKey(orgSlug)
  const disconnect = useAtomSet(disconnectStorageAtom(key), {
    mode: "promiseExit"
  })

  return (
    <div className="flex w-full flex-col gap-4">
      <StorageStatusRows status={status} waiting={waiting} />
      <StorageCorsPanel />
      <p className="text-xs text-muted-foreground">
        {m.storage_disconnect_hint()}
      </p>
      <ConfirmButton.Root className="justify-start">
        <ConfirmButton.Trigger type="button" variant="secondary">
          {m.storage_disconnect_button()}
        </ConfirmButton.Trigger>
        <ConfirmButton.Confirm className="flex-wrap justify-start">
          <StorageDisconnectConfirm disconnect={disconnect} />
        </ConfirmButton.Confirm>
      </ConfirmButton.Root>
    </div>
  )
}

function StorageDisconnectConfirm({
  disconnect
}: {
  disconnect: () => Promise<Exit.Exit<OrgStorageStatus, unknown>>
}) {
  const { close, busy, setBusy } = useConfirmButton()
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const exit = await disconnect()
    if (Exit.isSuccess(exit)) {
      close()
      return
    }
    setBusy(false)
    setError(errorMessage(Cause.squash(exit.cause) as AppError))
  }

  return (
    <>
      <span className="inline-flex h-8 items-center whitespace-nowrap text-xs text-muted-foreground">
        {m.storage_disconnect_confirm()}
      </span>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => void run()}
        disabled={busy}
      >
        {m.storage_disconnect_button()}
      </Button>
      <ConfirmButton.Cancel>{m.common_cancel_button()}</ConfirmButton.Cancel>
      {error !== null ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </>
  )
}

function StorageStatusRows({
  status,
  waiting
}: {
  status: OrgStorageStatus
  waiting: boolean
}) {
  if (status.status === "not_connected") {
    return <StorageNotConnectedPanel waiting={waiting} />
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-background px-4 py-3",
        waiting && "animate-pulse"
      )}
    >
      <p className="text-sm font-medium">
        {status.status === "broken"
          ? m.storage_broken()
          : m.storage_connected()}
      </p>
      <StatusRow label={m.storage_endpoint_label()} value={status.endpoint} />
      <StatusRow label={m.storage_bucket_label()} value={status.bucket} />
      <StatusRow label={m.storage_region_label()} value={status.region} />
      <StatusRow
        label={m.storage_access_key_label()}
        value={status.accessKeyIdMasked}
      />
      {status.lastCheckedAt ? (
        <StatusRow
          label={m.storage_last_checked()}
          value={status.lastCheckedAt.toLocaleString(getLocale())}
        />
      ) : null}
      {status.lastCheckError ? (
        <p className="text-sm text-destructive">{status.lastCheckError}</p>
      ) : null}
    </div>
  )
}

function StatusRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">
        {value ?? m.storage_value_none()}
      </span>
    </div>
  )
}

function StorageSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="h-20 w-full animate-pulse rounded-lg bg-muted" />
      <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
    </div>
  )
}

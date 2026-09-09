import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { useState, type ReactNode } from "react"
import type {
  AttachmentRow as AttachmentRowData,
  AttachmentSort
} from "@projectproject/shared"
import {
  deleteOrgAttachmentsAtom,
  ORG_ATTACHMENTS_PAGE_SIZE,
  orgAttachmentsAtom,
  orgAttachmentsSummaryAtom
} from "@/atoms/attachments"
import { orgAttachmentsKey } from "@/atoms/orgAttachmentsKey"
import { orgStorageAtom } from "@/atoms/storage"
import { projectsListAtom } from "@/atoms/projects"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import { ConfirmButton, useConfirmButton } from "@/components/ui/confirm-button"
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import { type AppError, errorMessage } from "@/lib/errorMessage"
import { m } from "@/paraglide/messages"
import { Pagination } from "./Pagination"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Row } from "./Row"
import {
  allDeletableSelected,
  deletableIds,
  isDeletable,
  prunedSelection,
  toggleSelection
} from "./selection"
import { Toolbar, type StatusFilter } from "./Toolbar"
import { Totals } from "./Totals"

const deletePrompt = (input: {
  readonly count: number
  readonly referenced: number
}): string => {
  if (input.referenced === 0) {
    return input.count === 1
      ? m.attachments_delete_confirm()
      : m.attachments_delete_selected_confirm({ count: input.count })
  }
  if (input.count === 1) {
    return input.referenced === 1
      ? m.attachments_delete_confirm_referenced_one()
      : m.attachments_delete_confirm_referenced_many({
          count: input.referenced
        })
  }
  return input.referenced === 1
    ? m.attachments_delete_selected_confirm_referenced_one({
        count: input.count
      })
    : m.attachments_delete_selected_confirm_referenced_many({
        count: input.count,
        referenced: input.referenced
      })
}

export function AttachmentsBrowser({ orgSlug }: { orgSlug: string }) {
  const [status, setStatus] = useState<StatusFilter>("all")
  const [projectSlug, setProjectSlug] = useState<string | null>(null)
  const [sort, setSort] = useState<AttachmentSort>("created_desc")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())

  const key = orgAttachmentsKey({
    orgSlug,
    ...(status === "all" ? {} : { status }),
    ...(projectSlug === null ? {} : { projectSlug }),
    sort,
    page
  })

  const listResult = useAtomValue(orgAttachmentsAtom(key))
  const summaryResult = useAtomValue(orgAttachmentsSummaryAtom(orgSlug))
  const projectsResult = useAtomValue(projectsListAtom(orgSlug))
  const remove = useAtomSet(deleteOrgAttachmentsAtom(key), {
    mode: "promiseExit"
  })

  const projects = Result.isSuccess(projectsResult)
    ? projectsResult.value.map((project) => ({
        slug: project.slug,
        name: project.name
      }))
    : []

  const resetPaging = () => {
    setPage(1)
    setSelected(new Set())
  }

  return (
    <AttachmentStorageGate orgSlug={orgSlug}>
      <div className="flex w-full flex-col gap-4">
        {Result.matchWithError(summaryResult, {
          onInitial: () => (
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
          ),
          onError: (error) => <ErrorPage error={error} contained />,
          onDefect: (defect) => <ErrorPage error={defect} contained />,
          onSuccess: ({ value }) => <Totals summary={value} />
        })}

        <Toolbar
          status={status}
          onStatusChange={(next) => {
            setStatus(next)
            resetPaging()
          }}
          projectSlug={projectSlug}
          projects={projects}
          onProjectChange={(next) => {
            setProjectSlug(next)
            resetPaging()
          }}
          sort={sort}
          onSortChange={(next) => {
            setSort(next)
            resetPaging()
          }}
        />

        {Result.matchWithError(listResult, {
          onInitial: () => <TableSkeleton />,
          onError: (error) => <ErrorPage error={error} contained />,
          onDefect: (defect) => <ErrorPage error={defect} contained />,
          onSuccess: ({ value, waiting }) => (
            <AttachmentsTable
              orgSlug={orgSlug}
              rows={value.items}
              page={page}
              total={value.total}
              onPageChange={(next) => {
                setPage(next)
                setSelected(new Set())
              }}
              waiting={waiting}
              filtered={status !== "all" || projectSlug !== null}
              selected={prunedSelection(selected, value.items)}
              onToggle={(id) =>
                setSelected((current) => toggleSelection(current, id))
              }
              onToggleAll={() =>
                setSelected((current) =>
                  allDeletableSelected(current, value.items)
                    ? new Set()
                    : new Set(deletableIds(value.items))
                )
              }
              onDelete={async (ids) => {
                const exit = await remove(ids)
                if (Exit.isSuccess(exit)) {
                  setSelected(new Set())
                  return null
                }
                return errorMessage(Cause.squash(exit.cause) as AppError)
              }}
            />
          )
        })}
      </div>
    </AttachmentStorageGate>
  )
}

function AttachmentStorageGate({
  orgSlug,
  children
}: {
  orgSlug: string
  children: ReactNode
}) {
  const storage = useAtomValue(orgStorageAtom(orgSlug))
  return Result.matchWithError(storage, {
    onInitial: () => <TableSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value }) =>
      value.status === "not_connected" ? (
        <Empty variant="inline" className="border border-dashed border-border">
          <EmptyTitle className="text-sm font-medium">
            {m.attachments_empty_no_storage_title()}
          </EmptyTitle>
          <EmptyDescription className="max-w-sm text-xs">
            {m.attachments_empty_no_storage_body()}
          </EmptyDescription>
        </Empty>
      ) : (
        <TooltipProvider>{children}</TooltipProvider>
      )
  })
}

function AttachmentsTable({
  orgSlug,
  rows,
  page,
  total,
  onPageChange,
  waiting,
  filtered,
  selected,
  onToggle,
  onToggleAll,
  onDelete
}: {
  orgSlug: string
  rows: ReadonlyArray<AttachmentRowData>
  page: number
  total: number
  onPageChange: (page: number) => void
  waiting: boolean
  filtered: boolean
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onDelete: (ids: ReadonlyArray<string>) => Promise<string | null>
}) {
  const selectedIds = [...selected]
  const referencedCount = rows.filter(
    (row) => selected.has(row.id) && row.tickets.length > 0
  ).length

  if (rows.length === 0) {
    return (
      <div className={waiting ? "animate-pulse" : undefined}>
        <EmptyRows filtered={filtered} />
        <Pagination
          page={page}
          pageSize={ORG_ATTACHMENTS_PAGE_SIZE}
          total={total}
          onPageChange={onPageChange}
        />
      </div>
    )
  }

  return (
    <div className={waiting ? "animate-pulse" : undefined}>
      <div className="max-h-[calc(100vh-24rem)] min-h-64 overflow-auto rounded-lg border border-border">
        <table className="w-full min-w-[720px] table-auto border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th scope="col" className="w-6 px-2 py-2 font-normal">
                <input
                  type="checkbox"
                  className="size-4 rounded border border-border align-middle"
                  checked={allDeletableSelected(selected, rows)}
                  onChange={onToggleAll}
                  disabled={deletableIds(rows).length === 0}
                  aria-label={m.attachments_select_all()}
                />
              </th>
              <th scope="col" className="w-full px-2 py-2 font-normal">
                {m.attachments_column_file()}
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                {m.attachments_column_project()}
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                {m.attachments_column_ticket()}
              </th>
              <th scope="col" className="px-2 py-2 text-right font-normal">
                {m.attachments_column_size()}
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                {m.attachments_column_status()}
              </th>
              <th scope="col" className="px-2 py-2 font-normal">
                {m.attachments_column_uploaded()}
              </th>
              <th scope="col" className="w-0 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.id}
                orgSlug={orgSlug}
                row={row}
                selected={selected.has(row.id)}
                onToggle={onToggle}
              >
                <DeleteCell row={row} onDelete={onDelete} />
              </Row>
            ))}
          </tbody>
        </table>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex items-center justify-end gap-3 pt-3">
          <ConfirmButton.Root>
            <ConfirmButton.Trigger type="button" variant="secondary" size="sm">
              {m.attachments_delete_selected({ count: selectedIds.length })}
            </ConfirmButton.Trigger>
            <ConfirmButton.Confirm className="flex-wrap justify-end">
              <DeleteConfirm
                prompt={deletePrompt({
                  count: selectedIds.length,
                  referenced: referencedCount
                })}
                ids={selectedIds}
                onDelete={onDelete}
              />
            </ConfirmButton.Confirm>
          </ConfirmButton.Root>
        </div>
      ) : null}

      <Pagination
        page={page}
        pageSize={ORG_ATTACHMENTS_PAGE_SIZE}
        total={total}
        onPageChange={onPageChange}
      />
    </div>
  )
}

function EmptyRows({ filtered }: { filtered: boolean }) {
  return (
    <Empty variant="inline" className="border border-dashed border-border">
      <EmptyTitle className="text-sm font-medium">
        {filtered
          ? m.attachments_empty_filtered_title()
          : m.attachments_empty_none_title()}
      </EmptyTitle>
      <EmptyDescription className="max-w-sm text-xs">
        {filtered
          ? m.attachments_empty_filtered_body()
          : m.attachments_empty_none_body()}
      </EmptyDescription>
    </Empty>
  )
}

function DeleteCell({
  row,
  onDelete
}: {
  row: AttachmentRowData
  onDelete: (ids: ReadonlyArray<string>) => Promise<string | null>
}) {
  if (!isDeletable(row)) return <span />

  return (
    <ConfirmButton.Root className="justify-end">
      <ConfirmButton.Trigger
        type="button"
        variant="ghost"
        size="sm"
        className="opacity-0 transition-opacity group-hover/reveal:opacity-100 focus-visible:opacity-100"
      >
        {m.attachments_delete_button()}
      </ConfirmButton.Trigger>
      <ConfirmButton.Confirm className="absolute top-1/2 -right-1 z-20 -translate-y-1/2 flex-nowrap rounded-lg border border-border bg-popover py-1 pr-2 pl-3.5 whitespace-nowrap shadow-sm">
        <DeleteConfirm
          prompt={deletePrompt({
            count: 1,
            referenced: row.tickets.length
          })}
          ids={[row.id]}
          onDelete={onDelete}
        />
      </ConfirmButton.Confirm>
    </ConfirmButton.Root>
  )
}

function DeleteConfirm({
  prompt,
  ids,
  onDelete
}: {
  prompt: string
  ids: ReadonlyArray<string>
  onDelete: (ids: ReadonlyArray<string>) => Promise<string | null>
}) {
  const { close, busy, setBusy } = useConfirmButton()
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const failure = await onDelete(ids)
    if (failure === null) {
      close()
      return
    }
    setBusy(false)
    setError(failure)
  }

  return (
    <>
      <span className="inline-flex h-8 items-center whitespace-nowrap text-xs text-muted-foreground">
        {prompt}
      </span>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        onClick={() => void run()}
        disabled={busy}
      >
        {m.attachments_delete_button()}
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

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2, 3, 4].map((row) => (
        <div
          key={row}
          className="h-10 w-full animate-pulse rounded-md bg-muted"
        />
      ))}
    </div>
  )
}

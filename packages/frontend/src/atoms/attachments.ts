import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import { ATTACHMENT_PAGE_SIZE } from "@projectproject/shared"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import { splitOrgAttachmentsKey } from "./orgAttachmentsKey"
import { splitTicketKey } from "./tickets"

export class AttachmentUploadFailed extends Data.TaggedError(
  "AttachmentUploadFailed"
)<{
  readonly reason: "status" | "network" | "abort"
  readonly status?: number
}> {}

export interface UploadAttachmentInput {
  readonly file: File
  readonly signal?: AbortSignal
  readonly onProgress?: (fraction: number) => void
}

export interface UploadedAttachment {
  readonly id: string
  readonly url: string
  readonly filename: string
  readonly contentType: string
}

export const uploadAttachmentAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime.fn(
    Effect.fn(function* (input: UploadAttachmentInput) {
      const aborted = Effect.suspend(() =>
        input.signal?.aborted === true
          ? Effect.fail(new AttachmentUploadFailed({ reason: "abort" }))
          : Effect.void
      )

      yield* aborted

      const client = yield* ApiClient
      const prepared = yield* client.attachments.prepare({
        params: { orgSlug, slug, id },
        payload: {
          filename: input.file.name,
          contentType: input.file.type,
          byteSize: input.file.size
        }
      })

      yield* aborted

      yield* Effect.callback<void, AttachmentUploadFailed>((resume, signal) => {
        const xhr = new XMLHttpRequest()
        const abort = () => xhr.abort()
        signal.addEventListener("abort", abort)
        xhr.open("PUT", prepared.uploadUrl, true)
        xhr.setRequestHeader("content-type", input.file.type)
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            input.onProgress?.(event.loaded / event.total)
          }
        }
        xhr.onload = () =>
          resume(
            xhr.status >= 200 && xhr.status < 300
              ? Effect.void
              : Effect.fail(
                  new AttachmentUploadFailed({
                    reason: "status",
                    status: xhr.status
                  })
                )
          )
        xhr.onerror = () =>
          resume(Effect.fail(new AttachmentUploadFailed({ reason: "network" })))
        xhr.onabort = () =>
          resume(Effect.fail(new AttachmentUploadFailed({ reason: "abort" })))
        xhr.send(input.file)
        return Effect.sync(() => {
          signal.removeEventListener("abort", abort)
          xhr.abort()
        })
      })

      yield* aborted

      const committed = yield* client.attachments.commit({
        params: { orgSlug, slug, id, attachmentId: prepared.id }
      })

      return {
        id: committed.id,
        url: committed.url,
        filename: committed.filename,
        contentType: committed.contentType
      } satisfies UploadedAttachment
    })
  )
})

export const ORG_ATTACHMENTS_PAGE_SIZE = ATTACHMENT_PAGE_SIZE

const attachmentsReactivityKey = (orgSlug: string) => ["attachments", orgSlug]

const orgAttachmentsBaseAtom = Atom.family((key: string) => {
  const query = splitOrgAttachmentsKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.attachments.list({
          params: { orgSlug: query.orgSlug },
          query: {
            limit: ORG_ATTACHMENTS_PAGE_SIZE,
            page: query.page,
            ...(query.status ? { status: query.status } : {}),
            ...(query.projectSlug ? { projectSlug: query.projectSlug } : {}),
            ...(query.sort ? { sort: query.sort } : {})
          }
        })
      })
    )
    .pipe(
      Atom.withReactivity(attachmentsReactivityKey(query.orgSlug)),
      Atom.setIdleTTL("30 seconds")
    )
})

export const orgAttachmentsAtom = Atom.family((key: string) =>
  Atom.optimistic(orgAttachmentsBaseAtom(key))
)

export const orgAttachmentsSummaryAtom = Atom.family((orgSlug: string) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.attachments.summary({ params: { orgSlug } })
      })
    )
    .pipe(
      Atom.withReactivity(attachmentsReactivityKey(orgSlug)),
      Atom.setIdleTTL("30 seconds")
    )
)

export const deleteOrgAttachmentsAtom = Atom.family((key: string) => {
  const query = splitOrgAttachmentsKey(key)
  return Atom.optimisticFn(orgAttachmentsAtom(key), {
    reducer: (current, ids: ReadonlyArray<string>) => {
      if (!Result.isSuccess(current)) return current
      const removed = new Set(ids)
      const items = current.value.items.filter((row) => !removed.has(row.id))
      return Result.success(
        {
          items,
          total: Math.max(
            0,
            current.value.total - (current.value.items.length - items.length)
          )
        },
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (ids: ReadonlyArray<string>) {
        const client = yield* ApiClient
        yield* Effect.forEach(
          ids,
          (attachmentId) =>
            client.attachments.remove({
              params: { orgSlug: query.orgSlug, attachmentId }
            }),
          { concurrency: 4 }
        ).pipe(
          Effect.ensuring(
            Reactivity.invalidate(attachmentsReactivityKey(query.orgSlug))
          )
        )
      })
    )
  })
})

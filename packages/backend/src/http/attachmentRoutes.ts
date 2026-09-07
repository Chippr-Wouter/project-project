import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { parseAttachmentUrl } from "@projectproject/shared"
import * as Effect from "effect/Effect"
import { toWebHeaders } from "./toWebHeaders"
import { Attachments } from "../Services/Attachments"
import { BetterAuth } from "../Services/BetterAuth"

const notFound = HttpServerResponse.text("Not Found", { status: 404 })

const serveAttachment = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const url = new URL(webReq.url)
  const ref = parseAttachmentUrl(url.pathname)
  if (!ref) return notFound

  const ba = yield* BetterAuth
  const session = yield* ba
    .getSession(toWebHeaders(req.headers))
    .pipe(Effect.orElseSucceed(() => null))
  if (session === null) {
    return HttpServerResponse.text("Unauthorized", { status: 401 })
  }

  const attachments = yield* Attachments
  const { url: signed } = yield* attachments.resolveForServing(
    ref.orgSlug,
    ref.id,
    session.user.id,
    { download: url.searchParams.get("download") === "1" }
  )
  return HttpServerResponse.redirect(signed, {
    status: 302,
    headers: { "cache-control": "private, no-store" }
  })
}).pipe(
  Effect.catchTags({
    NotFound: () => Effect.succeed(notFound),
    Forbidden: () => Effect.succeed(notFound),
    StorageNotConnected: () => Effect.succeed(notFound),
    StorageConfigMissing: () =>
      Effect.succeed(
        HttpServerResponse.text("Storage unavailable", { status: 503 })
      ),
    StorageError: () =>
      Effect.succeed(
        HttpServerResponse.text("Storage unavailable", { status: 502 })
      )
  }),
  Effect.catchCause((cause) =>
    Effect.andThen(
      Effect.logError("attachment route failure", cause),
      Effect.succeed(
        HttpServerResponse.text("Attachment failed", { status: 500 })
      )
    )
  )
)

export const attachmentRoutes = serveAttachment

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse
} from "@effect/platform"
import * as Effect from "effect/Effect"
import { toWebHeaders } from "./toWebHeaders"
import { BetterAuth } from "../Services/BetterAuth"
import { FigmaLinks } from "../Services/FigmaLinks"
import { parseFigmaThumbnailUrl } from "../Services/FigmaLinks"

const notFound = HttpServerResponse.text("Not Found", { status: 404 })

const serveFigmaThumbnail = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const webReq = yield* HttpServerRequest.toWeb(req)
  const url = new URL(webReq.url)
  const ref = parseFigmaThumbnailUrl(url.pathname)
  if (!ref) return notFound

  const ba = yield* BetterAuth
  const session = yield* ba
    .getSession(toWebHeaders(req.headers))
    .pipe(Effect.orElseSucceed(() => null))
  if (session === null) {
    return HttpServerResponse.text("Unauthorized", { status: 401 })
  }

  const figmaLinks = yield* FigmaLinks
  const signed = yield* figmaLinks.resolveThumbnailUrl(
    ref.orgSlug,
    session.user.id,
    ref.linkId
  )
  return HttpServerResponse.redirect(signed, {
    status: 302,
    headers: { "cache-control": "private, no-store" }
  })
}).pipe(
  Effect.catchTags({
    NotFound: () => notFound,
    Forbidden: () => notFound,
    StorageNotConnected: () => notFound,
    StorageConfigMissing: () =>
      HttpServerResponse.text("Storage unavailable", { status: 503 }),
    StorageError: () =>
      HttpServerResponse.text("Storage unavailable", { status: 502 })
  }),
  Effect.catchAllCause((cause) =>
    Effect.zipRight(
      Effect.logError("figma thumbnail route failure", cause),
      HttpServerResponse.text("Figma thumbnail failed", { status: 500 })
    )
  )
)

export const figmaThumbnailRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/:orgSlug/:linkId", serveFigmaThumbnail)
)

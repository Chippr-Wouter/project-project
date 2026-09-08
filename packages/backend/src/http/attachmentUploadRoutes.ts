import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { Validation } from "@projectproject/shared"
import * as AttachmentUploads from "../Services/AttachmentUploads"
import { mapToolError } from "../mcp/errorMap"

const failure = (error: unknown, status: number) =>
  HttpServerResponse.jsonUnsafe(
    { error: mapToolError(error).content[0].text },
    { status, headers: { "cache-control": "no-store" } }
  )

export const attachmentUploadRoute = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const url = new URL(request.url, "http://localhost")
  const uploads = yield* AttachmentUploads.AttachmentUploads
  const attachment = yield* uploads.receive(
    url.searchParams.get("token") ?? "",
    request.headers["content-type"] ?? "",
    request.stream.pipe(
      Stream.mapError(
        () => new Validation({ reason: "Could not read upload body." })
      )
    )
  )
  return HttpServerResponse.jsonUnsafe(attachment, {
    headers: { "cache-control": "no-store" }
  })
}).pipe(
  Effect.catchTags({
    Unauthorized: () =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(
          {
            error:
              "Upload URL is invalid or expired. Call prepare_ticket_attachment again."
          },
          { status: 401, headers: { "cache-control": "no-store" } }
        )
      ),
    NotFound: (error) => Effect.succeed(failure(error, 404)),
    Forbidden: (error) => Effect.succeed(failure(error, 403)),
    AttachmentTooLarge: (error) => Effect.succeed(failure(error, 413)),
    AttachmentTypeRejected: (error) => Effect.succeed(failure(error, 415)),
    AttachmentNotUploaded: (error) => Effect.succeed(failure(error, 502)),
    StorageNotConnected: (error) => Effect.succeed(failure(error, 409)),
    StorageConfigMissing: (error) => Effect.succeed(failure(error, 503)),
    StorageError: (error) => Effect.succeed(failure(error, 502)),
    Validation: (error) => Effect.succeed(failure(error, 400))
  }),
  Effect.catchDefect(() =>
    Effect.succeed(
      HttpServerResponse.jsonUnsafe(
        { error: "Attachment upload failed." },
        { status: 500, headers: { "cache-control": "no-store" } }
      )
    )
  )
)

// packages/backend/src/Layers/Auth.ts
//
// THE AUTHENTICATION MIDDLEWARE — LIVE IMPLEMENTATION.
// ============================================================================
// The `Authentication` Tag, the `CurrentUser` Tag, and the cookie security
// scheme are all declared in `packages/shared/src/Authentication.ts`. This
// file *implements* the Live Layer — the runtime logic that reads the cookie,
// asks Better Auth who's logged in, and either provides a `User` to the
// handler or fails with `Unauthorized`.
//
// SHAPE OF AN HTTPAPIMIDDLEWARE LIVE LAYER
// ----------------------------------------------------------------------------
// `HttpApiMiddleware.Tag` produces a class that, like any Effect service, you
// implement via `Layer.effect`. The shape is "for each declared security
// scheme, an Effect that returns the `provides` type or fails with the
// `failure` type". Here we have one scheme (`sessionCookie`), so the
// implementation is one method.
//
// The framework parses the cookie according to the `HttpApiSecurity.apiKey`
// declaration and passes its value as the function argument. We don't
// actually use that argument — Better Auth wants the *full* request headers,
// not just the cookie value — but the framework still enforces "cookie must
// be present" as a precondition. Without one, the request short-circuits
// with `Unauthorized` *before* this function runs.
//
// MAPPING THE BOUNDARY ERROR
// ----------------------------------------------------------------------------
// `BetterAuth.getSession` can fail with `BetterAuthError` (e.g. DB blip,
// malformed cookie payload). The wire type of this middleware is
// `Unauthorized`, so we collapse `BetterAuthError → Unauthorized` via
// `Effect.mapError`. The cause is lost from the client's perspective; if you
// want it preserved server-side, log it via `Effect.tapCause(...)` first.
//
// `getSession` also returns `null` when the cookie is structurally valid but
// expired/revoked. That isn't a Promise rejection, just a `null` result — we
// translate it to `Unauthorized` explicitly.
//
// DEPENDENCY DIRECTION
// ----------------------------------------------------------------------------
// `AuthenticationLive` requires `BetterAuth`. `BetterAuthLive` provides it.
// In `main.ts`, both must be reachable from the server layer; the standard
// way is to provide `BetterAuthLive` somewhere underneath `AuthenticationLive`
// in the `Layer.provide` chain.

import { HttpServerRequest } from "effect/unstable/http"
import {
  Authentication,
  CurrentUser,
  type EditorPreference,
  Unauthorized
} from "@projectproject/shared"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { toWebHeaders } from "../http/toWebHeaders"
import { BetterAuth } from "../Services/BetterAuth"

function normalizeEditorPreference(value: unknown): EditorPreference {
  switch (value) {
    case "github_dev":
    case "vscode":
    case "cursor":
      return value
    case "github":
    default:
      return "github"
  }
}

export const AuthenticationLive = Layer.effect(
  Authentication,
  Effect.gen(function* () {
    const ba = yield* BetterAuth

    return Authentication.of({
      sessionCookie: (httpEffect, _options) =>
        Effect.gen(function* () {
          const req = yield* HttpServerRequest.HttpServerRequest
          const session = yield* ba
            .getSession(toWebHeaders(req.headers))
            .pipe(Effect.mapError(() => new Unauthorized()))

          if (session === null) {
            return yield* new Unauthorized()
          }
          // Shape Better Auth's user into the shared `User` schema. The fields
          // line up by name, but Better Auth types `image` as
          // `string | null | undefined` (optional + nullable), whereas our
          // wire schema is `Schema.NullOr(Schema.String)` — strictly
          // `string | null`. Normalize `undefined → null` here so the seam
          // stays narrow. This is exactly the DTO mapping the schema exists
          // to host: even when the fields look identical, the codec is the
          // contract, not the source struct.
          const { id, email, name, image, createdAt } = session.user
          // `username` was added via Better Auth's `additionalFields`; it
          // shows up at runtime but isn't on the inferred type. Cast at the
          // seam — the schema is what guards the wire.
          const username =
            (session.user as { username?: string | null }).username ?? null
          const editorPreference = normalizeEditorPreference(
            (session.user as { editorPreference?: string | null })
              .editorPreference
          )
          // `activeOrganizationId` lives on the session row (organization
          // plugin). Resolve to a slug here so the wire shape is the
          // human-readable identifier the frontend builds URLs from.
          const activeOrganizationId = (
            session.session as { activeOrganizationId?: string | null }
          ).activeOrganizationId
          const activeOrgSlug = yield* ba
            .getOrgSlugById(activeOrganizationId)
            .pipe(Effect.orDie)
          const personalGithub = yield* ba
            .getPersonalGithub(id)
            .pipe(Effect.orDie)
          const personalEverhour = yield* ba
            .getPersonalEverhour(id)
            .pipe(Effect.orDie)
          return yield* Effect.provideService(httpEffect, CurrentUser, {
            id,
            email,
            name,
            username,
            image: image ?? null,
            createdAt,
            activeOrgSlug,
            personalGithub,
            editorPreference,
            personalEverhour
          })
        })
    })
  })
)

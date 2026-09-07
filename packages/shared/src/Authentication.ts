// packages/shared/src/Authentication.ts
//
// THE AUTHENTICATION MIDDLEWARE TAG (CONTRACT, NOT IMPLEMENTATION).
// ============================================================================
// HttpApi's middleware system splits cleanly into two halves:
//
//   - The *Tag*: declares the security scheme(s), the value the middleware
//     provides downstream, and the failure type. It contains zero runtime
//     logic. Both the API definition (in `api.ts`) and the live Layer (in
//     backend) import this Tag.
//
//   - The *Live Layer*: actually reads the cookie, calls Better Auth, and
//     either provides a `User` or fails with `Unauthorized`. Lives in
//     `packages/backend/src/services/Auth.ts` because it depends on
//     `BetterAuth`, which lives in backend.
//
// We put the Tag here in `shared/` so both `api.ts` (which calls
// `.middleware(Authentication)` on a group) and the backend's Live Layer
// can reference the same Tag identity.
//
// THREE PIECES TO DECLARE
// ----------------------------------------------------------------------------
//   1. `CurrentUser` — a `Context.Tag` whose value is the authenticated user.
//      Handlers `yield* CurrentUser` to access it.
//
//   2. The cookie security scheme — `HttpApiSecurity.apiKey({ in: "cookie",
//      key: "better-auth.session_token" })`. The key must match the cookie
//      name Better Auth actually sets. Inspect a real cookie in devtools
//      after the OAuth round-trip; the prefix may vary by version.
//
//   3. `Authentication` — an `HttpApiMiddleware.Tag` declaring:
//        provides: CurrentUser
//        security: { sessionCookie }
//        failure:  Unauthorized
//
// USING IT
// ----------------------------------------------------------------------------
// In `api.ts`, decorate any group whose endpoints require auth:
//
//   const Auth = HttpApiGroup.make("auth")
//     .add(HttpApiEndpoint.get("me", "/me").addSuccess(User).addError(Unauthorized))
//     .middleware(Authentication)
//
// Later groups (`projects`, `tickets`) will get the same treatment.
//
// USER TYPE FOR THE TAG
// ----------------------------------------------------------------------------
// `CurrentUser`'s value type is the schema-defined `User` from
// `./schemas/User.ts` — *not* Better Auth's inferred user type. Why? Because
// the Tag is used in `shared/`, which knows nothing about Better Auth.
// The middleware Layer (in backend) is responsible for ensuring the value
// it provides matches the shared `User` shape.

import * as Context from "effect/Context"
import type { User } from "./schemas/User"
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi"
import { Unauthorized } from "./errors"

export class CurrentUser extends Context.Service<CurrentUser, User>()(
  "@projectproject/shared/Authentication/CurrentUser"
) {}

const sessionCookie = HttpApiSecurity.apiKey({
  in: "cookie",
  key: "better-auth.session_token"
})

export class Authentication extends HttpApiMiddleware.Service<
  Authentication,
  {
    provides: CurrentUser
  }
>()("Authentication", {
  error: Unauthorized,
  security: { sessionCookie }
}) {}

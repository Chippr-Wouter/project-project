// packages/backend/src/handlers/auth.ts
//
// THE `auth` HTTPAPI GROUP — HANDLER LAYER.
// ============================================================================
// One endpoint to implement: `GET /me`. The handler is dramatically boring
// — and that boringness is the point. The Authentication middleware (in
// `services/Auth.ts`) did all the work before this handler ran. By the time
// we get here, `CurrentUser` is already populated in the Effect context;
// the handler just yields it and returns.
//
// WHY HANDLERS ARE THIN
// ----------------------------------------------------------------------------
// `docs/PROJECTPROJECT.md` is explicit about the rule:
//
//   > Handlers stay thin — they're plumbing. All logic is in services.
//
// `/me` is the smallest possible example: zero logic, just "return what the
// middleware injected". When we add `projects` and `tickets` groups, their
// handlers stay this thin too — they call `Projects.list`, `Tickets.create`,
// etc. and return the result. Every interesting decision lives in a service
// or in a middleware.
//
// If a handler ever feels like it's accumulating logic, that's the signal to
// push it into a service.

import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppApi, CurrentUser } from "@projectproject/shared"
import * as Effect from "effect/Effect"

export const AuthHandlerLive = HttpApiBuilder.group(
  AppApi,
  "auth",
  (handlers) =>
    handlers.handle("me", () =>
      Effect.gen(function* () {
        const user = yield* CurrentUser
        return user
      })
    )
)

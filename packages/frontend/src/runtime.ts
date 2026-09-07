import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Atom from "effect/unstable/reactivity/Atom"
// packages/frontend/src/runtime.ts
//
// THE FRONTEND'S EFFECT RUNTIME, EXPRESSED AS AN ATOM RUNTIME.
// ============================================================================
// This is the file that turns "Effect on the frontend" from an idea into a
// real runtime React can render against. It does two things:
//
//   1. Compose `AppLayer` — every service the frontend's atoms might yield,
//      merged into a single Layer.
//   2. Wrap that Layer in `Atom.runtime(...)` so we can build atoms whose
//      Effect bodies have access to those services.
//
// You import the resulting `runtime` everywhere you want to define an atom:
//
//   const meAtom = runtime.atom(
//     Effect.gen(function*() {
//       const client = yield* ApiClient
//       return yield* client.auth.me()
//     })
//   )
//
// The atom's Effect channel is `Effect<User, Unauthorized, ApiClient>`. The
// runtime erases the `R` channel by providing `ApiClient.Default` underneath,
// so React only sees a `Result<User, Unauthorized>` when reading the atom.
//
// WHY MERGE LAYERS HERE
// ----------------------------------------------------------------------------
// In a backend you might have one big graph; here, the frontend has very few
// services (just `ApiClient` to start). But the *pattern* of "compose all of
// it in one place, hand it to the runtime" is the one we want to establish
// early. Every later chapter that adds a frontend service (e.g. a localStorage
// wrapper, a Lexical-aware markdown service) will drop a `LayerName.Default`
// into `Layer.mergeAll(...)` and not touch anything else.
//
// HOW IT FITS WITH THE BACKEND'S RUNTIME
// ----------------------------------------------------------------------------
// They're separate. The backend has its own Layer chain (built in
// `packages/backend/src/main.ts`). The frontend has this one. The seam
// between them is the wire: HTTP, JSON, and the schemas in
// `packages/shared`. Neither runtime knows the other exists.
//
// CHAPTER 3 STEPS
// ----------------------------------------------------------------------------
//   1. Imports:
//        import { Layer } from "effect"
//        import * as Atom from "effect/unstable/reactivity/Atom"
//        import { ApiClient } from "@/services/ApiClient"
//
//   2. Compose the AppLayer:
//        export const AppLayer = Layer.mergeAll(ApiClient.Default)
//      (Yes, one entry. `mergeAll` future-proofs it for services we'll add.)
//
//   3. Build the runtime:
//        export const runtime = Atom.runtime(AppLayer)
//
// WHAT YOU SHOULD NOT DO
// ----------------------------------------------------------------------------
// Don't `Effect.runPromise` anything in this file. Don't add React imports.
// `runtime.ts` is *just* the Effect/Atom plumbing. The component layer is
// where the React concerns live.

import * as Layer from "effect/Layer"
import { ApiClient } from "@/services/ApiClient"

export const AppLayer = Layer.mergeAll(ApiClient.Default)

export const runtime = Atom.runtime(AppLayer)

export const registry = Registry.make()

# AGENTS.md — ProjectProject

## Project context

This repo builds **ProjectProject**, a markdown-first project management tool described in `docs/PROJECTPROJECT.md`. **Read that file first** before any non-trivial response — it is the spec we're building toward.

**For any UI/frontend work**, also read `PRODUCT.md` (strategic design context — users, brand personality, aesthetic direction, design principles) and `DESIGN.md` (visual system — color tokens, typography hierarchy, elevation, component primitives, named rules, do's and don'ts). Both are binding for visual and interaction decisions. Use the project UI quality checklist when working on UI so the change is reviewed against the product and design rules.

The project started as a structured Effect-learning curriculum (chapter-by-chapter exercises in `docs/chapters/`). Wouter has now absorbed enough Effect to shift to a **normal collaborative implementation workflow**. The chapter docs stay in the repo for reference, but the chapter-viewer app is gone and we no longer follow the stub-and-exercise pattern.

## Wouter

TypeScript engineer, frontend background, comfortable with Effect v3 fundamentals (Layers, scopes, tagged errors, `Effect.gen`, `HttpApi`, `@effect-rx`). Works in a real engineering setting most of the time and is fine pair-programming with AI. Treat him as a peer, not a student — but he's still building Effect intuition, so flag non-obvious choices when you make them.

## How we work

We implement the app together. You can write working code anywhere in the repo (`backend/`, `frontend/`, `shared/`). The split is collaborative:

- **You implement** — services, handlers, atoms, components, schemas. Working code is the norm.
- **Wouter reviews and steers** — he decides direction; you propose and execute.

### No architectural decisions without asking

This is the firm rule. **Do not make architectural decisions unilaterally.** That includes:

- Picking libraries (state mgmt, routing, validation, styling, ORM additions, etc.).
- Adding new packages to the workspace or new top-level modules.
- Choosing data-flow patterns (where state lives, how a feature is sliced, sync vs async boundaries).
- Naming conventions for shared concepts (route layouts, atom families, service tags).
- API surface decisions on `packages/shared` (endpoint shape, error taxonomy, schema modeling).

When you hit one of these, **stop and ask**. Present the options with tradeoffs; let Wouter pick. Implementation details inside an already-agreed shape are fine to just do.

### Tone

- Short, direct, peer-level. No teaching voice unless he asks for one.
- Show the why before the what when something is non-obvious.
- No emoji unless asked.

## Frontend stack

- **TanStack Start + TanStack Router** as already wired up.
- **`@effect/atom-react`** for Effect-aware state (`Atom.runtime`, atom families, etc.).
- **shadcn/ui (Radix-backed)** as the component foundation. Install via the shadcn CLI.
- **Fluid Functionalism components** from <https://www.fluidfunctionalism.com>, installed through the shadcn registry (`npx shadcn@latest registry add @fluid`). Also Radix-backed, so they coexist cleanly with shadcn defaults. Prefer these where they exist for richer motion-aware primitives before reaching for something custom.
- Don't add other UI libraries (Headless UI, Mantine, Chakra, etc.) without asking — see the architecture rule above.

### No comments

Default: write zero comments. Self-explanatory names, clean structure, and small functions carry the meaning. Inline comments are noise — they distract during review, rot independently of the code, and signal a missing abstraction.

Exception: a single short line is acceptable only when a value would actively mislead a future reader (a workaround for a documented bug, a non-obvious browser quirk, a load-bearing token name). Even then, ask yourself whether the comment is hiding a rename or refactor that would remove the need.

Forbidden, regardless: multi-line comment blocks, design-rationale prose, layout reasoning, "this used to be X" notes, restatements of what the code obviously does, before/after explanations, and "we picked this because" passages. Those go in the commit message. If you catch yourself writing more than one line, delete the whole comment.

### Press feel — buttons scale down on active

Buttons should scale to **97%** on `:active` with a **100–150ms** transform transition, so the user feels the press land. Use `active:scale-[0.97]` (or `active:[&>span]:scale-[0.97]` when the button's content is what should compress, e.g. an icon button) paired with `transition-transform duration-100`.

This applies to every clickable button in the app — not just the obvious primaries. Skip only when the element is non-interactive or the press is already conveyed by another animation (e.g. an inline-form trigger that immediately morphs).

### Hover feel — instant in, eased out

Hover (and Radix `[data-highlighted]` / `[data-selected]`) state changes should land **instantly on enter** and **ease out at ~150ms on exit**. That asymmetry is what makes the app feel responsive without feeling twitchy.

Implementation lives as a single global rule in `packages/frontend/src/styles.css`: while the element is hovered or carries the highlight data attribute, `transition-duration` is forced to `0ms`; once the cursor leaves (or the highlight clears), the override is gone and the element's underlying transition-duration governs the exit.

When a parent reveals a child on hover (a row's actions, say), the child is not itself hovered, so give the parent a named reveal group — `group/reveal` — and pair it with `group-hover/reveal:*` on the child; the global rule covers that name alongside `group/hitbox`.

For this to work, hover-affected elements must have a transition class set up — typically `transition-colors` (Tailwind default 150ms). If a hover-driven color change has no `transition-*` class, both directions snap and the rule has nothing to override. Add `transition-colors` (or `transition-opacity` / `transition-all` as appropriate) when introducing a new hover state.

When you write a new component with hover behavior, always pair the hover class with the matching transition utility — e.g. `transition-colors hover:bg-accent`, not bare `hover:bg-accent`.

### Prefer component variants over local styling

When you find yourself writing a one-off styled version of an existing component (different size, chrome, spacing, etc.), **add a variant to the component instead of rolling local Tailwind in the callsite**. Local styles compound: the second time we want the same look we have to copy classes; the third time they drift. A typed variant prop on the primitive keeps the design language singular and reusable.

Concrete example: the inline-pill version of `SegmentedTabs` (used for "Update status to: …") lives as `variant="inline"` on the primitive, not as a hand-rolled set of classes inside `CreateBranchFields`. Same rule applies to buttons, inputs, badges, etc. — extend the primitive, don't reskin it locally.

If extending the primitive feels disruptive (touches public API, would conflict with other callsites), stop and ask before going local.

## i18n

- All user-facing strings go through paraglide messages (`m.*` from `@/paraglide/messages`); raw literals in JSX are forbidden.
- User-authored markdown (ticket descriptions, project READMEs, comments) stays as authored — never translated.
- Errors map through `packages/frontend/src/lib/errorMessage.ts`. Extend that file when adding new tagged errors that surface in the UI.
- `Intl.*` callsites take the active locale, read via `getLocale()` from `@/paraglide/runtime`. No `format.ts` wrapper layer.
- Source locale: `en`. Adding `nl` is a future PR (the locale switcher ships with it).
- Translation placement is governed by this ruleset, not by a validation script.
- Message IDs stay flat and prefix-based, for example `tickets_search_placeholder`.
- Keep existing message IDs unchanged when moving or reorganizing translations.
- Place new translations in the file/domain that owns their prefix.
- Use `common_` only for strings shared across unrelated domains. Do not move a string to `common_` only because the English text is generic.
- Domain-specific actions stay domain-specific, for example `project_detail_delete_button`, not `common_delete_button`.
- If a new domain or prefix is introduced, update this section and the Inlang `pathPattern` in the same PR.
- Future locales must mirror the same file layout and message IDs as `en`.

| File                                          | Prefixes                                               |
| --------------------------------------------- | ------------------------------------------------------ |
| `packages/frontend/messages/en/common.json`   | `common_`, `error_`, `validation_`                     |
| `packages/frontend/messages/en/shell.json`    | `chrome_`, `nav_`, `theme_`                            |
| `packages/frontend/messages/en/account.json`  | `auth_`, `profile_`                                    |
| `packages/frontend/messages/en/projects.json` | `org_`, `projects_`, `project_`, `members_`, `editor_`, `storage_`, `attachments_` |
| `packages/frontend/messages/en/comments.json` | `comments_`                                            |
| `packages/frontend/messages/en/tickets.json`  | `tickets_`                                             |
| `packages/frontend/messages/en/tags.json`     | `tags_`, `color_`                                      |
| `packages/frontend/messages/en/git.json`      | `git_`, `github_`                                      |
| `packages/frontend/messages/en/sprints.json`  | `sprints_`, `error_sprint_`                            |
| `packages/frontend/messages/en/time.json`     | `time_`                                                |
| `packages/frontend/messages/en/figma.json`    | `figma_`                                               |

Within each message file, group keys by prefix in the order listed above, then sort alphabetically inside each prefix group.

## Mutations and optimistic updates

**Default to optimistic.** Any mutation that updates a list or aggregate the user is staring at should flip the UI synchronously and let the server resolve in the background. We use Effect-Atom's first-party `Atom.optimistic` + `Atom.optimisticFn` — don't invent custom optimistic layers.

**Every mutation atom is family-keyed** by the resource it affects — `projectKey(orgSlug, slug)` for project-scoped, `ticketKey(orgSlug, slug, id)` for ticket-scoped, `orgSlug` for org-scoped. This applies to both optimistic mutations (`Atom.optimisticFn`) and plain ones (`runtime.fn`). The reason: a mutation atom's `AsyncResult` (waiting / failure) is per-key, so concurrent mutations on different resources don't share status, and a stale failure on one resource doesn't bleed onto another. Path fields (`orgSlug`, `slug`, `id`) come from the key, not the input — keep input shapes equal to the API payload.

```ts
export const updateTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime.fn(
    Effect.fn(function* (input: UpdateTicketInput, get) {
      /* ... */
    })
  )
})

// caller
const update = useAtomSet(updateTicketAtom(ticketKey(orgSlug, slug, id)))
update({ status: "in_progress" })
```

**The optimistic shape:**

1. Split the read into a private base + public optimistic wrapper:

   ```ts
   const xBaseAtom = Atom.family((key: string) =>
     runtime.atom(Effect.gen(function* () { ... })).pipe(Atom.setIdleTTL("..."))
   )
   export const xAtom = Atom.family((key: string) => Atom.optimistic(xBaseAtom(key)))
   ```

   Consumers read `xAtom`. The base stays unexported (or near-unexported — only mutation atoms in the same module reference it).

2. Mutations that affect `x` are family-keyed `Atom.optimisticFn`:

   ```ts
   export const mutateAtom = Atom.family((key: string) =>
     Atom.optimisticFn(xAtom(key), {
       reducer: (current, input) => {
         if (!AsyncResult.isSuccess(current)) return current
         return AsyncResult.success(applyOptimistically(current.value, input), {
           waiting: true
         })
       },
       fn: runtime.fn(
         Effect.fn(function* (input, get) {
           const updated = yield* api.mutate(input)
           get.refresh(xBaseAtom(key)) // pull server truth — optimistic mirror auto-updates
           get.refresh(otherAffectedAtoms)
           return updated
         })
       )
     })
   )
   ```

3. **Always refresh the _base_ atom**, never the optimistic wrapper, after the mutation lands. Refreshing the wrapper would loop.

4. **The reducer's job is the synthetic next state.** It must match what the server will return well enough that the brief moment before the refresh isn't visibly wrong. When the result is hard to model (e.g. a PR number assigned by GitHub), use a **pulse-only reducer** instead — return the current value with `{ waiting: true }` so the UI flips its pulse animation without inventing fake data:

   ```ts
   reducer: (current, _input) =>
     AsyncResult.isSuccess(current)
       ? AsyncResult.success(current.value, { waiting: true })
       : current
   ```

   This keeps the data display honest and still gives the user a "syncing" affordance. See `openPrAtom` for an example.

5. **Surface `waiting` in the UI.** The optimistic atom carries `result.waiting: true` while the mutation is in flight. Apply `animate-pulse` (or equivalent) on the elements that just changed so the user sees their action land but knows it's not confirmed yet. Don't pulse idle controls, only the data display.

6. **Submitting / error state.** A form that owns its mutation atom directly reads `result.waiting` and `AsyncResult.isFailure(result)` from `useAtomValue(mutationAtom(key))` rather than mirroring into `useState`:

   ```ts
   const create = useAtomSet(createTicketAtom(projKey), { mode: "promiseExit" })
   const createState = useAtomValue(createTicketAtom(projKey))
   const submitting = createState.waiting
   const error = AsyncResult.isFailure(createState)
     ? m.tickets_create_error_fallback()
     : null
   ```

   Forms wired through reusable shells (`InlineForm`, `ConfirmButton`) keep their imperative `setBusy` / `setError` API — the shell doesn't know which atom is firing, so it needs an explicit signal. Same for callsites whose UX needs richer state than the atom carries (e.g. tracking _which_ row in a list is in flight when the atom only says "something is").

Reference: `packages/frontend/src/atoms/github.ts` (`createBranchAtom`, `attachBranchAtom`); `packages/frontend/src/components/CreateTicketRow.tsx` for the direct-form pattern.

## Rendering atom AsyncResults — `AsyncResult.matchWithError` + `ErrorPage`

A `useAtomValue` on a runtime atom returns a `AsyncResult<A, E>` with four variants: `Initial`, `Success`, `Failure-with-typed-error`, `Failure-with-defect`. **Always handle all four — never just check `AsyncResult.isSuccess` and render a forever-loading state on anything else.** That swallows real errors silently and makes failures invisible.

**The canonical helper is `AsyncResult.matchWithError`** from `effect/unstable/reactivity/AsyncResult`. It splits the failure path into `onError` (your typed `E` channel — `NotFound`, `Unauthorized`, etc.) and `onDefect` (unexpected throws, decode failures, interruptions). Failed renders use the shared `ErrorPage` component (`packages/frontend/src/components/ErrorPage.tsx`), which wraps the dither shell with a retry button and a home link. Pass `contained` when rendering inside a settings panel or any non-full-page surface.

The minimal pattern:

```tsx
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import { ErrorPage } from "@/components/ErrorPage"

function ProjectStatusesSettings() {
  const result = useAtomValue(projectStatusesAtom(projectKey(orgSlug, slug)))

  return AsyncResult.matchWithError(result, {
    onInitial: () => <LoadingSkeleton />,
    onError: (error) => <ErrorPage error={error} contained />,
    onDefect: (defect) => <ErrorPage error={defect} contained />,
    onSuccess: ({ value }) => <StatusList statuses={value} />
  })
}
```

A few details worth knowing:

- **`onError` receives the typed error itself** (the value from the `E` channel, with its `_tag`), not the Failure variant. Narrow on `error._tag` if you want to render different messages per error kind — but `ErrorPage` already does this via `lib/errorMessage.ts` for any `AppError`, so most callsites just pass `error` through.
- **`onDefect` receives the unknown cause** (a Cause defect, a thrown JS error, a decode failure). Treat it the same way — pass it to `ErrorPage`, which falls back to `String(defect)` for the detail line.
- **`onSuccess` argument is the Success variant** (`{ value, waiting }`), not the raw value. Destructure `value` to get your data. The `waiting: true` flag is set during an in-flight optimistic mutation (per the optimistic-mutation conventions above) — useful when you want to pulse the success view while a refresh is happening.
- **Don't combine `AsyncResult.matchWithError` with a separate `if (!AsyncResult.isSuccess) ...` early return.** Pick one. The `match` form handles every case; mixing both is dead code and a refactor hazard.
- **For tiny callsites where you only care about success vs anything else** (e.g. a sidebar count that defaults to 0), `AsyncResult.isSuccess(result) ? result.value : fallback` is fine. The match form pays for itself once the failure case needs visible UI.

Reference: `packages/frontend/src/routes/_authed/orgs/$orgSlug/projects/index.tsx` for the standard project-list pattern; `packages/frontend/src/atoms/auth.ts` for the long-form docstring explaining the AsyncResult variants.

## Backend stack

Effect HttpApi + Drizzle + Better Auth + Postgres, as set up in chapters 0–2. Extend within those choices unless we explicitly revisit them.

## Repo orientation

- **Spec / source of truth:** `docs/PROJECTPROJECT.md`
- **Reference material:** `docs/chapters/` — chapter docs and walk-throughs from the learning phase. Read-only context; we don't add new chapters.
- **Code:**
  - `packages/backend` — Effect HTTP server.
  - `packages/frontend` — TanStack Start app.
  - `packages/shared` — HttpApi definition, schemas, tagged errors. The typed seam between ends.

The `packages/chapters-viewer` workspace has been removed.

## What you may freely do

- Read any file in the repo.
- Run `git status` / `git diff` / `git log`.
- Run `bun install`, `bun test`, type-checks, lint, format.
- Write working code in any package.

## What requires asking first

- Architectural decisions (see list above).
- Installing new dependencies that aren't already implied by the current task.
- Destructive git operations.
- Touching `docs/PROJECTPROJECT.md` or `docs/chapters/` content.

## When in doubt

Re-read the relevant section of `docs/PROJECTPROJECT.md`, then ask. Cheaper to confirm than to redo.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Learning more about Effect

This repository uses Effect v4. Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and follow its linked guides as needed. Search `node_modules/effect/src` for API definitions. See `docs/migrations/effect-v4-handoff.md` for migration guidance.

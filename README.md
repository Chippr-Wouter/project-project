# ProjectProject

A markdown-first project management tool, built as a vehicle for learning Effect deeply.

The full spec lives in [`docs/PROJECTPROJECT.md`](docs/PROJECTPROJECT.md). The chapter-by-chapter learning material lives in [`docs/chapters/`](docs/chapters/). The teaching workflow that governs how this repo evolves lives in [`CLAUDE.md`](CLAUDE.md).

## Layout

```
projectproject/
├── package.json              # Bun workspaces root
├── tsconfig.base.json        # Shared compiler options
├── docs/
│   ├── PROJECTPROJECT.md     # The spec
│   └── chapters/             # Learning material + exercises
├── packages/
│   ├── shared/               # HttpApi contract + Schemas + tagged errors
│   ├── backend/              # HttpApi server, services, db
│   └── frontend/             # React SPA, atoms, routes
└── data/                     # Markdown source of truth (gitignored)
```

## Prerequisites

- Node.js 24.15.0 (`.node-version`) — Vite Plus runs on Node; `engines`
  accepts `^22.18.0 || >=24.11.0`.
- [Bun](https://bun.sh) 1.3.13 (`packageManager`) — installs dependencies and
  runs the backend.
- Postgres for running the app. The test suite needs neither `.env` nor a
  database.

## Getting started

```bash
bun install
```

Install runs `effect-tsgo patch`, which patches TypeScript 7 so both
command-line typechecks and the native editor language service report Effect
diagnostics. Install the recommended extensions (Vite Plus pack + TypeScript
native preview) and select the workspace TypeScript version when prompted.

```bash
bun run dev           # Postgres, then backend + frontend in parallel
bun run check         # vp check (format + lint), then typecheck per package
bun run test          # Backend, frontend, and shared suites
bun run build         # Frontend production build
```

Every script shells out to the pinned `vite-plus` in `node_modules`, so a
global `vp` is optional. With the [Vite Plus CLI](https://viteplus.dev/guide/)
installed, `vp install` delegates to Bun (it reads `packageManager`) and
`vp run <script>` is interchangeable with `bun run <script>`. Mind the
difference between `vp run dev` (the workspace script) and bare `vp dev`
(only the Vite dev server).

`bun run dev` waits for the Postgres container to report healthy
(`docker compose up --wait`), then runs the frontend (`vp dev`) and backend
(`bun --watch`) dev scripts in parallel. Postgres stays up after you exit;
stop it with `bun run dev:stop`.

## Tooling

Bun and Vite Plus split the work:

| Concern                                  | Tool                                             |
| ---------------------------------------- | ------------------------------------------------ |
| Dependencies, workspaces, lockfile       | Bun (`bun.lock`)                                 |
| Backend runtime and watcher              | Bun (`bun --watch src/main.ts`)                  |
| Script running, filtering, parallelism   | Vite Plus (`vp run --filter … --parallel`)       |
| Dev server and production build          | Vite Plus (Vite)                                 |
| Tests                                    | Vite Plus (bundled Vitest 4.1.11)                |
| Lint and format                          | Vite Plus (`vp lint`, `vp fmt`)                  |
| Typecheck                                | TypeScript 7 patched with `@effect/tsgo`         |

Root `vite.config.ts` owns lint rules, formatter options, and the test
projects (`packages/*/vite.config.ts`, four workers). Each package's
`vite.config.ts` owns its own root, plugins, build, and named test project.
The workspace-only lint rule lives in `tools/oxlint-plugin-workspace.js`.

Run one suite with `bun run test --project backend` (or `frontend` /
`shared`), and `bun run --cwd packages/backend test:watch` for backend watch
mode. `bun run lint:fix` and `bun run format` apply fixes.

Lint severities: `correctness` is an error, `suspicious` and `perf` warn, and
the React compiler rules (`refs`, `set-state-in-effect`, `immutability`,
`static-components`) warn. Formatting skips generated Drizzle snapshots,
`routeTree.gen.ts`, the vendored Everhour schema, and markdown.

Typechecking sits outside `vp check` deliberately: `bun run check` finishes
with `vp run -r typecheck`, one `tsc --noEmit` per package through the patched
TypeScript 7, which preserves the Effect diagnostics configured in
`tsconfig.base.json`. The frontend's typecheck compiles Paraglide messages
first (with TypeScript declarations), and the Paraglide Vite plugin does the
same for dev, build, and test — so a fresh checkout needs no manual codegen
step.

Root `overrides` map `vite` onto Vite Plus's Vite distribution so every plugin
resolves a single Vite, and pin `vitest` to the 4.1.11 that Vite Plus bundles.
`@effect/vitest` stays at 0.29.0 for Effect v3 and declares a Vitest 3 peer
range; the pin overrides it, with compatibility covered by the backend Effect
test suite. Upgrade the Vitest pin together with Vite Plus and rerun the full
suite. Effect itself remains on v3.

Frontend tests run in forked workers with Node's native web storage disabled,
so jsdom supplies browser-local storage.

CI installs through `voidzero-dev/setup-vp` (pinned by `.node-version`), then
runs `vp install --frozen-lockfile` followed by `vp run check`, `test`, and
`build`. The Docker images build on `node:24.15.0-bookworm-slim` with the Bun
binary copied in for installs; the backend runtime image is
`oven/bun:1.3.13-slim`.

The setup follows [T3 Code's tooling layout](https://github.com/pingdotgg/t3code),
with Bun retained for this project's runtime and package manager.

## Bootstrapping a fresh instance

ProjectProject is **invite-only**. There is no public "first user creates the
org" flow, and org creation stays gated (`allowUserToCreateOrganization: false`
in `packages/backend/src/auth.ts`). A fresh instance is seeded once, then grows
by invitation.

1. **Seed the first org + owner.** Set the `BOOTSTRAP_*` values in `.env` (see
   [`.env.example`](.env.example) — org slug/name and the owner's email, name,
   and optional username), then run the seeding script:

   ```bash
   bun --filter @projectproject/backend run bootstrap:org
   ```

   It creates the organization, the owner identity, and their `owner`
   membership. The command is repeat-safe: re-running reports the existing
   records instead of creating duplicates. Use the same email the owner will
   sign in with (magic link or Google).

2. **Owner signs in and invites the team.** The owner signs in with the
   configured email, opens org settings → members, and invites teammates by
   email.

3. **Invited users land from their invite.** Each invitation produces a link
   (`/invite/<invitationId>`, logged by `sendInvitationEmail`). Opening it
   sends a signed-out user through login (with the invite preserved) and then
   drops them on a focused accept screen; accepting sets the invited org active
   and lands them inside it. Signed-in users can also review every pending
   invitation at `/welcome`. Invites match on email, so members sign in with the
   address they were invited under.

For production and Docker specifics (running the seed inside the container,
migrations, reverse proxy) see [`docs/deploy.md`](docs/deploy.md).

## Conventions

- **Effect v3 stable.** All Effect code targets v3; `Schema` is imported from `effect`.
- **The shared package is the contract.** Endpoints declared in `packages/shared/src/api.ts` drive both the backend implementation and the frontend's typed client.
- **Markdown is the source of truth.** Postgres holds only auth + a thin project index; everything else lives under `data/projects/`.

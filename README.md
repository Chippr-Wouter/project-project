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

- Node.js 24.15.0 (see `.node-version`) for Vite Plus and its test runner.
- [Bun](https://bun.sh) 1.3.13 for dependency installation and the backend runtime.
- Postgres for running the app; the test suite uses mocks and temporary directories.

## Getting started

```bash
bun install
```

The install step patches TypeScript 7 with `@effect/tsgo`, so command-line
checks and the native editor language service include Effect diagnostics.
Install the recommended VS Code/Cursor extensions and select the workspace
TypeScript version when prompted.

```bash
bun run check         # Formatting, linting, and native TypeScript + Effect checks
bun run test          # All backend, frontend, and shared tests
bun run build         # Frontend production build
bun run dev           # Postgres, backend, and frontend (uses .env)
```

These scripts use the project's pinned Vite Plus installation; a global `vp`
installation is optional. With the [Vite Plus CLI](https://viteplus.dev/guide/)
installed, `vp install` uses Bun and `vp run <script>` runs the same scripts.
Use `vp run dev` for the full app: bare `vp dev` starts only Vite.

## Tooling

Root `vite.config.ts` owns linting, formatting, and the three test projects.
Each package's `vite.config.ts` owns its local build/test settings. Run a single
suite with `bun run test --project backend` (or `frontend` / `shared`), and use
`bun run --cwd packages/backend test:watch` for backend watch mode.

`vp check` handles formatting and type-aware linting. `bun run check` also runs
our patched native compiler, preserving the Effect diagnostics configured in
`tsconfig.base.json`. Paraglide 2.25 supports TypeScript 7 declaration generation;
frontend checks and tests generate translations automatically on a fresh checkout.
The obsolete `importFromBarrel` diagnostic was removed from the configuration
because `@effect/tsgo` no longer provides it.

The four newly available React compiler lint rules start at warning severity;
existing correctness rules remain errors. Generated database snapshots and the
vendored Everhour API schema are excluded from formatting.

The root overrides keep all Vite plugins on Vite Plus's Vite distribution and
all tests on its bundled Vitest 4.1.11. `@effect/vitest` stays at 0.29.0 for
Effect v3; its declared Vitest 3 peer range is overridden, with compatibility
covered by the backend Effect test suite. Upgrade the Vitest pin together with
Vite Plus and rerun the full suite. Effect itself remains on v3.

Frontend test workers disable Node's native web storage so jsdom supplies
browser-local storage. The test runner needs neither `.env` nor a running database.

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

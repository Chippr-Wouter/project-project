# Effect v4 migration handoff

## Scope and baseline

Worktree: `/Users/luukmunneke/personal/project-project-effect-v4`.
Stack: main → chore/vite-plus-tooling → chore/better-auth-17 → chore/effect-v4.
Baseline commit: 0baf403fd. Baseline checks, build, and 752 tests pass (4 skipped).
Preserve HTTP contracts, validation/default behavior, errors, scopes, optimistic updates, and test coverage. This is a migration, not a feature redesign.

All Effect packages are pinned to 4.0.0-rc.112. Native TypeScript 7 and Vite Plus stay as configured on the parent branch.

## Read before editing

Read root AGENTS.md and node_modules/effect/AGENTS.md completely. The installed rc.112 source is authoritative; documentation examples can lag renames. Read linked ai-docs examples for the APIs you change.

Official migration index: https://github.com/Effect-TS/effect/blob/main/MIGRATION.md
Official guides are downloaded to `/tmp/projectproject-effect-v4-guides/`: schema.md, services.md, cause.md, error-handling.md, forking.md, yieldable.md, fiber-keep-alive.md, layer-memoization.md, fiberref.md, runtime.md, scope.md, equality.md, v3-to-v4.md. Read relevant guides, not just the generated rename map.

## Important mappings

- Context.Tag(id)<Self, Shape>() → Context.Service<Self, Shape>()(id). Preserve identifiers and separate service/layer files.
- @effect/platform HttpApi modules → effect/unstable/httpapi. HTTP modules → effect/unstable/http. FileSystem/Path → effect/FileSystem and effect/Path.
- @effect/sql/SqlClient → effect/unstable/sql/SqlClient.
- @effect-atom/atom-react → @effect/atom-react; core Atom and AsyncResult APIs live under effect/unstable/reactivity. Inspect actual exports: do not assume old Result names/shapes remain.
- catchAll → catch; catchAllCause → catchCause; tapErrorCause → tapCause. Check typed-error vs defect behavior.
- effect/Either → effect/Result (success/failure/value/error). This is distinct from atom AsyncResult.
- effect/TestClock → effect/testing/TestClock.
- Schema.decodeUnknown → decodeUnknownEffect; encode → encodeEffect. Sync decoders stay sync.
- Schema.Union(A,B) → Union([A,B]); Literal(a,b) → Literals([a,b]); Record({key,value}) → Record(key,value).
- Schema annotations → annotate; Date → DateFromString, DateFromSelf → Date. Preserve encoded wire format.
- Schema refinements use check(isMinLength(...)) etc. Read schema.md for optional/default semantics and transformations; don't weaken validation.
- Cause is flattened. Don't preserve v3 tree matching with casts.
- Layer.scoped and scope boundaries changed; inspect Layer API rather than deleting acquisition/finalizers.
- HttpApi endpoint/security/middleware construction changed substantially. Read installed ai-docs/src/51_http-server examples and HttpApi*.ts source.

## Database boundary

Root owns database driver decisions and integration. Better Auth uses its own Promise-based drizzle-orm/node-postgres client. Never pass an Effect database to Better Auth. The application uses Drizzle 1 RC's effect-postgres adapter and Relations v2; Better Auth uses node-postgres against the same schema.

## Ownership

- Shared agent: packages/shared/** except package.json.
- Frontend agent: packages/frontend/** except package.json. Preserve UI and i18n, optimistic family keys, base-atom refreshes, failure rendering.
- Backend agent: packages/backend/** except package.json, src/Layers/Db.ts, src/Services/Db.ts, src/auth.ts, src/Layers/BetterAuth.ts, db schema/migration artifacts. Root owns these exclusions.
- Root: manifests/lockfile, database exclusions, root configuration/docs, review and integration.

Do not edit another agent's files; report cross-package fixes. Do not commit, install dependencies, format the entire repository, modify protected spec/chapter docs, use any/as-unknown-as to hide errors, drop tests, or start real services. No production/database access.

## Verification

Run package checks with `../../node_modules/.bin/tsc --noEmit` from your package, capture logs under /tmp. Shared errors can cascade while shared migration is running. Run scoped tests using root `bun run test --project <name>` after inspecting vite.config project names. Root runs final full typecheck, check, test, and build. Report semantic changes and unresolved concerns explicitly.

## Migration status

The Effect v4 migration is complete in this worktree. The dependency baseline is:

- Effect packages: `4.0.0-rc.112`
- `@effect/atom-react`: `4.0.0-rc.112`
- Better Auth and `@better-auth/mcp`: `1.7.3`
- Drizzle ORM: `1.0.0-rc.5-169397b`
- Drizzle Kit: `1.0.0-rc.5-ab785fc`
- TypeScript: `7.0.2`
- Vite Plus: `0.3.0`
- Bun: `1.3.13`

The frontend migration preserves optimistic atom behavior, Result/AsyncResult failure rendering, existing UI, and i18n. Better Auth MCP/OAuth uses the signed full authorization query, the v1.7 protected-resource middleware, and the new OAuth provider tables. The frontend discovery proxy preserves the complete `/.well-known/` path for the backend.

The converted Drizzle history keeps the existing SQL byte-identical while moving each migration into Drizzle's timestamped directory layout (`<timestamp>_<name>/migration.sql`). The new Better Auth 1.7 migration is `20260907091000_better_auth_17`; it is additive and contains the compatibility conversion described in the operational migration guide.

The database compatibility and MCP OAuth compatibility tests use only an isolated local database whose name starts with `projectproject_effect_v4_`. They are skipped when `PROJECTPROJECT_TEST_DATABASE_URL` is unset. Use the root `test:db` script for those checks; do not point it at a shared or production database.

## Final verification

`bun run check`, the production frontend build, and 753 regular tests pass. Six database tests run separately with `bun run test:db`; they exercise both drivers, auth sessions, MCP discovery/registration/PKCE, token refresh rotation and replay rejection, actual MCP initialization, consent-bound JWT revocation, and cross-user application revocation.

All 29 historical SQL migrations are byte-identical after the official Drizzle history conversion. Fresh migration and an upgrade from the previous Drizzle migrator were exercised on disposable Postgres 17 databases. Existing attachment timestamp precision differences between schema and historical database were left unchanged; a future generated migration may still propose those pre-existing alterations.

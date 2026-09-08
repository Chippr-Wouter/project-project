# Incremental ticket sync prototype

The ticket overview now supports checkpointed bootstrap and delta polling for the isolated measure/ten-thousand fixture.

## Behavior

- Bootstrap returns active ticket metadata and an epoch/revision checkpoint.
- Delta returns upserts, deleted IDs, the next checkpoint, a reset flag and a hasMore flag.
- Poll every two seconds while the overview is mounted; also poll on window focus and online events. Overlapping triggers in a tab are coalesced while a request is running.
- Persist the updated snapshot and checkpoint together in one IndexedDB transaction, then invalidate ticket atoms.
- Each tab keeps its own in-memory snapshot. When another tab has advanced the shared IndexedDB record, a stale response adopts that persisted snapshot instead of overwriting it.
- A new epoch or a checkpoint ahead of the server requests a fresh bootstrap.
- Delta pages cover at most 1,000 log entries. Each poll drains available pages before completing.
- Confirmed ticket mutations catch up the replica before refreshing list atoms. Typed catch-up failures are logged without reporting an already committed server mutation as failed; background polling retries.
- Active metadata queries in default created-descending order use the complete replica. Search, archive, group filters, other ordering, and cursors retain server filtering and pagination. Counts use the same coverage boundary without an ordering restriction.
- List invalidation uses the benchmark stack's project-scoped keys; background deltas do not refetch ticket bodies.

This remains an opt-in, fixture-specific prototype. Existing cursor and bulk-bootstrap experiments remain selectable separately.

## Benchmark stack integration — September 8, 2026

Merged `origin/fix/T-118-index-publication` (PR #152, top of the benchmark stack). Verification used a production frontend build and the disposable database on port 55439, backend on 3110, and preview on 4196.

- Default overview: 10,000 loaded tickets across three sections, 29 mounted rows; warm reload issued zero snapshot requests.
- Search: three server list requests, 50 loaded tickets per section.
- API title edit: present in the immediately following delta and then the visible overview. Original title restored.
- Archive: delta emitted the ticket ID as a tombstone; active snapshot contained 9,999 tickets. Unarchive restored the ticket.
- Workspace typecheck and production build passed. Focused tests: 43 frontend and 19 backend tests passed; six browser tests with real IndexedDB passed, including draining three delta pages in one poll.

These checks verify integration behavior; they are not a new before/after latency benchmark. Browser test clients now construct their own typed HTTP layer because the incoming production API layer explicitly binds global fetch.

## Consistency boundary

The disposable database has a project head row and a change log. An AFTER trigger on ticket_index increments the head and appends the changed ticket ID in the same transaction as the index mutation. The head row lock serializes revision allocation through commit: a later writer cannot commit a higher revision while an earlier revision is still uncommitted. Rollback undoes both revision and log entry.

Both endpoint reads use a REPEATABLE READ, READ ONLY transaction. Snapshot reads the checkpoint and active ticket index in that transaction, bypassing normal list pagination. Delta reads the head, bounded changed IDs and their current active metadata in the same view. Missing or archived IDs become tombstones. Delta payloads represent current metadata for changed IDs, not historical versions of each edit.

Consequently a committed index mutation is either visible in the snapshot or appears after its checkpoint. This boundary concerns the recoverable index: markdown stays canonical, and external file changes become visible to sync when indexing/reconciliation publishes them.

## Validation performed

Production frontend build, T3 Chrome 150, two tabs sharing http://localhost:4192 and the same browser IndexedDB database.

- Edited T-10000 through the API from tab A; tab B displayed the new title through delta polling.
- Created a temporary T-10001; tab B displayed it.
- Simulated offline in tab B by overriding navigator.onLine to false and dispatching offline. Waited for in-flight polling to settle; its last sync request timestamp then stayed unchanged.
- Deleted T-10001 through tab A. Tab B retained its old local row while paused.
- Restored navigator.onLine and dispatched online. Tab B removed the row in **108.6 ms** in that single observation. This is a simulated connectivity signal, not a browser-wide network-disconnection test or a latency benchmark.
- Reload recovered 10,000 persisted records, no temporary ticket, and checkpoint revision 2018 matching the server. T-10000's title was restored.
- Unauthenticated delta request returned 401; a different project returned 404.
- The disposable database verification script passed five checks: rollback, overlapping commit ordering, snapshot-boundary catch-up, >1,000-change pagination, and epoch reset/current snapshot.
- Frontend tests passed for idempotent update/deletion replay, rejecting older/different-epoch deltas, and the existing optimistic row-key behavior: three tests in two files.
- Workspace typecheck and production build passed. Lint completed with warnings; no lint errors.

The database verification script uses controlled SQL writes against the scratch index and restores original titles. Its boundary test explicitly holds a repeatable-read database view while another connection commits, then verifies the API delta. Browser create/edit/delete checks exercise the actual application mutation endpoints and markdown writes.

## Run against the existing disposable fixture

Install the fixture-only log/trigger:

```sh
docker exec -i pp-overview-10k psql -v ON_ERROR_STOP=1 -U measure -d measure < packages/backend/scripts/ticket-sync-prototype.sql
```

The SQL script refuses databases not named measure; the trigger records only fixture project UUID 00000000-0000-4000-8000-000000000010. It is intentionally not a production migration.

Start the isolated backend on 3110 with TICKET_SYNC_PROTOTYPE=true. Build:

```sh
VITE_TICKET_REPLICA_PROTOTYPE=true VITE_TICKET_SYNC_PROTOTYPE=true bun run --filter @projectproject/frontend build --outDir /tmp/pp-overview-10k/sync-dist
```

With PROTOTYPE_COOKIE set to the disposable fixture's signed session cookie:

```sh
PROTOTYPE_BACKEND_PORT=3110 PROTOTYPE_ALLOW_TICKET_WRITES=true bun packages/frontend/scripts/serve-overview-comparison.ts /tmp/pp-overview-10k/sync-dist 4192
```

Open /orgs/measure/projects/ten-thousand in two tabs. The proxy allows writes only when explicitly enabled, only against backend 3110, and only the fixture's quick-create and ticket PATCH/DELETE paths. Its default remains read-only.

Database checks, with no other fixture mutations running:

```sh
bun packages/backend/scripts/verify-ticket-sync-prototype.mjs
```

Frontend checks:

```sh
bunx vp test run --project frontend packages/frontend/src/atoms/ticketSyncPrototype.test.ts packages/frontend/src/components/TicketList/SectionList.test.tsx
```

Local database: PROTOTYPE-ticket-sync-v2. It is separate from previous snapshot experiments. The [cache lifecycle slice](CACHE-LIFECYCLE-PROTOTYPE.md) adds account ownership, revocation, and cross-tab cleanup; it does not import unowned v1 snapshots.

## Limits before promotion

- No log retention/compaction or automatic epoch rotation. An operator replacing the log must change the epoch and bootstrap clients again.
- The prototype serializes writes per project on one head row. Throughput and contention are unmeasured.
- A single snapshot record is rewritten for each nonempty delta. Per-ticket object stores would reduce large-project persistence work.
- Project scope remains restricted to the fixture. Account partitioning, logout cleanup, and confirmed project-access revocation are implemented; offline authenticated startup remains unresolved.
- Only changes published to ticket_index are tracked. Project configuration that affects derived metadata, memberships, related entities, and live GitHub data require their own invalidation/sync treatment.
- No offline mutation queue or complete optimistic-mutation reconciliation. This tests server mutations followed by local convergence.
- Transient sync failures preserve the current local state and retry on the next trigger; dedicated sync-status UI and backoff are not implemented.
- No payload compression or progressive bootstrap display.

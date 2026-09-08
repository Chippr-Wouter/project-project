# Ticket sync: render before bootstrap persistence

Measured September 8, 2026 against `b9bc4c3d4`, the incremental persistence implementation. Both versions use production builds with all three prototype flags enabled and the same disposable 10,000-ticket backend.

## Results

Five alternating before/after rounds, each empty-cache load followed by a persisted reload. All rows are available when the three overview lists become ready; only 29 rows are mounted.

| Final-build measurement, median | Before | After |
| --- | ---: | ---: |
| Empty-cache overview DOM ready | 2,431.3 ms | 822.4 ms |
| Persisted reload DOM ready | 716.5 ms | 722.4 ms |
| Complete cache observed after empty load | 2,602.8 ms | 1,913.7 ms |
| Tickets available at readiness | 10,000 | 10,000 |
| Initially mounted rows | 29 | 29 |
| Confirmed title save, 15 edits per version | 76.0 ms | 58.2 ms |

Empty-cache ranges: before 1,823.7–2,641.3 ms; after 608.2–1,044.0 ms. Reload ranges: before 626.1–754.2 ms; after 506.9–835.0 ms. Every persistence observation found exactly 10,000 tickets and one checkpoint.

The final paired run shows 66% lower median cold readiness. An earlier coalesced-read build, before the reset/cancellation hardening, measured 1,626.3 → 684.7 ms (58% lower), with reloads 539.4 → 661.5 ms. Machine/browser scheduling varied substantially, so these are local prototype results rather than universal latency guarantees. Both measured batches are retained; no slow rounds were discarded.

The title-save probe performs three alternating rounds of five edits on `T-10000`, restoring the original title after each batch. It warms the overview and waits for persistence before hard-navigating to the detail. Final save ranges: before 50.5–124.0 ms; after 46.4–78.3 ms. This does not measure an edit submitted while the initial write is still running; its catch-up can wait behind bootstrap. The HTTP mutation still runs before that catch-up, preserving the server write path for subsequent API/MCP reads. MCP itself was not exercised.

## Implementation

Bootstrap validates persisted ownership and project generation inside the write transaction before returning its tickets to current readers. Concurrent initial list/count reads share a Deferred so separate status columns do not queue behind the same bootstrap write. The pending-read entry is removed at first publication; later reads perform their normal checks.

A first-party Effect FiberSet owns the background work in the service scope. The replica semaphore remains held until commit, serializing subsequent deltas behind the bootstrap. Ticket rows and checkpoint still persist in one transaction. Reset cancels and drains the fibers; registration is uninterruptible, while waiting for a read remains interruptible. Failure removes provisional memory and leaves no partially committed replica. Background polling or a later read can retry.

This changes when data becomes usable, not how much data must be downloaded or stored. There is no worker, new database schema, dependency, shared HTTP endpoint, or partial-sync protocol. Persistence still runs through the existing Effect IndexedDB driver on the browser thread. DOM readiness does not establish paint timing, FPS, or responsiveness during the remaining persistence work.

## Verification

- Production build, frontend plus browser-harness typecheck, and changed-file lint passed.
- 19 focused unit tests passed.
- 17 real IndexedDB lifecycle cases passed, including concurrent early reads, write failure/retry, scope-close rollback, reset cancelling a held network request, revocation after publication, checkpoint validation, and newer delta preservation.
- Tests expecting persisted hydration now explicitly wait for a read transaction behind the bootstrap write before disposing their first runtime. Separate tests intentionally dispose before persistence.

## Reproduction and artifacts

Use the existing `overview-comparison-probes.js` and `overview-mutation-probe.js` with the production build command in the [preceding report](t118-indexeddb-save-fix.md). Before/after proxies are localhost:4196/4198, backend 3110, disposable PostgreSQL 16 on 55439. Bun 1.4.2, Effect 4.0.0-rc.112, T3 preview browser, observed viewport 1402 × 877. No builds or tests overlapped the final browser timing loops.

Empty-cache runs unload the app and delete only `PROTOTYPE-ticket-sync-v2`; assets and database buffers remain warm. Both origins had an exploratory warmup. A native readonly IndexedDB transaction after DOM readiness checks the snapshot count and ticket count; its completion time is an upper-bound observation of durability, not an instrumented commit timestamp. Only after it finishes does the warm reload begin.

Raw local artifacts: `.benchmark-results/bootstrap-2026-09-08/final-loads.json`, `final-mutations.json`, and `lifecycle.json`. Earlier exploratory batches are retained as `initial-loads.json`, `loads.json`, and `mutations.json`. This directory is gitignored. No production or daily-preview service was changed.

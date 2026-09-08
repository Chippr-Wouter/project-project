# Ticket sync: incremental persistence save fix

Measured September 8, 2026 against the full-snapshot sync build from `f62908a0e` (also the implementation at `a6c669e3c`). This follows the [integration remeasurement](t118-indexeddb-integration.md). Both variants include the benchmark stack, use production frontend builds with all three prototype flags enabled, and share the disposable 10,000-ticket backend.

## Confirmed saves

Three alternating before/after rounds, five real title edits each: 15 samples per version. Each batch warms the project overview, waits 2.2 seconds, then hard-navigates to ticket `T-10000` so the first edit exercises a fresh service runtime with a persisted cache. The probe restores the title after each batch.

Timing runs from Enter until the title input exits editing. This measures confirmation, not optimistic paint. Request timings end at response headers.

| Measurement | Full-snapshot persistence | Incremental persistence |
| --- | ---: | ---: |
| Median save confirmation | 181.8 ms | 46.4 ms |
| Save range | 166.5–286.4 ms | 34.9–58.8 ms |
| First save after hard navigation, three batches | 286.4 / 236.1 / 230.4 ms | 46.4 / 54.1 / 45.0 ms |
| Median PATCH duration | 18.6 ms | 22.2 ms |
| Median PATCH completion → detail GET start | 142.4 ms | 0.5 ms |
| Follow-up GETs per edit | 4 | 4 |

Median confirmation fell 74.5% in this paired run. The earlier report's 250.5 ms sync result is historical context; the contemporaneous control here is 181.8 ms. Authentication and delta requests remain alongside detail and tag-usage refreshes.

## What changed

IndexedDB schema version 2 separates snapshot checkpoint metadata from ticket rows. A delta writes only changed rows and tombstones, with its checkpoint in the same transaction. Memory publishes after that transaction succeeds. Account ownership and project generation checks remain inside the transaction.

Mutation catch-up reads the small checkpoint without hydrating 10,000 tickets in a fresh detail runtime. If no replica exists, mutation catch-up skips bootstrap; opening the overview still initializes it. The detail GET starts immediately after the PATCH, overlapping local catch-up. Mutations still reach the server before local reconciliation, preserving the server write path used by subsequent API/MCP reads. This run exercised HTTP, not an MCP client.

No backend implementation, virtualizer, dependencies, or shared HTTP API changed.

## Loading tradeoff

Five alternating rounds per version, each empty-cache load followed by a persisted reload. Asset caches and database buffers were not cleared; only prototype IndexedDB data was cleared on isolated origins after unloading the app. These are local browser observations, not a quiet-machine capacity study.

| Median | Before | After |
| --- | ---: | ---: |
| Empty-cache overview ready | 792.4 ms | 1,450.5 ms |
| Persisted reload ready | 534.8 ms | 625.6 ms |
| Warm About → Backlog navigation, five samples | 44.5 ms | 42.3 ms |
| Tickets available at readiness | 10,000 | 10,000 |
| Initially mounted rows | 29 | 29 |

Empty-cache ranges: before 733.1–1,021.0 ms; after 1,339.7–1,804.0 ms. Reload ranges: before 444.8–600.1 ms; after 472.2–662.2 ms.

The bootstrap now inserts 10,000 individually indexed records before publishing the list. This removes the per-edit full-snapshot rewrite at the cost of a slower initial fill. It is not an across-the-board loading improvement. Old schema data is invalidated once during upgrade, while auth/project generations are preserved. Close older prototype tabs before upgrading so their IndexedDB connections do not block migration.

Both warm-navigation batches made zero API requests. A scroll smoke retained the fixed 560,416 px extent and made no pagination requests, but browser visibility throttled animation frames (46 before, only 3 after). That run is insufficient evidence for a fresh scrolling smoothness or FPS claim; see the earlier report for the larger scrolling sample.

## Verification and reproduction

- Production frontend build and workspace typecheck passed.
- 19 focused unit tests passed.
- 12 real-browser IndexedDB lifecycle tests passed: account revocation, scope cleanup, checkpoint-only polling, invalid checkpoint rejection, single-row delta writes, atomic rollback, cross-runtime freshness, tombstones, schema migration, transport failure, and multi-page catch-up.
- Changed production files pass lint with four existing warnings in unrelated ticket atom code.

Same fixture as the integration report: PostgreSQL 16 on localhost:55439, backend 3110; before/after production proxies 4196/4198. Bun 1.4.2, Effect 4.0.0-rc.112, T3 preview browser, viewport 1402 × 877. No production or daily preview services were changed.

Use the existing `overview-mutation-probe.js` and `overview-comparison-probes.js` against the two production builds. Raw local artifacts are in `.benchmark-results/indexeddb-fix-2026-09-08/`: `mutations.json`, `loads.json`, `interactions.json`, and `lifecycle.json`. The results directory is gitignored; the table values and method are preserved here.

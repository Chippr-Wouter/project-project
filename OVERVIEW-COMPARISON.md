# Production overview: API versus IndexedDB

Question: does a persisted 10,000-ticket local snapshot make the actual overview load and scroll faster than API pagination?

## Result

Local data eliminated ticket requests and loading indicators during the measured scroll, and kept the scrollbar extent stable. Simply passing all records to the existing overview made initial rendering and warm navigation slower. This is not ready to promote as a performance fix.

| Measurement | API pagination | IndexedDB → memory |
| --- | ---: | ---: |
| Reload to all three sections mounted, median of 5 | 706.3 ms | 1,249.7 ms |
| Reload range | 582.8–780.4 ms | 1,113.2–1,430.1 ms |
| Warm About → Backlog, median of 10 | 47.3 ms | 416.3 ms |
| Warm navigation range | 30.6–58.7 ms | 358.3–627.9 ms |
| Tickets available at initial render | 150 | 10,000 |
| Initially mounted rows | 29 | 29 |
| API requests during warm navigation | 0 | 0 |
| Ticket requests during first 2.5-second scroll | 10 | 0 |
| Samples with visible loading indicator, first scroll | 3 / 156 | 0 / 117 |
| Scroll extent changes, first scroll | 10 | 0 |

Initial synchronization from an empty local database took **11,887.9 ms**; the overview mounted at **12,624.6 ms** (one sample). The prototype follows the existing sequential 50-ticket cursor API, requiring 200 pages to collect all records. That cost is included here and excluded from the persisted-reload column. The browser's default resource buffer truncated the bootstrap request trace; the measured bootstrap duration and resulting 10,000-record count are intact.

IndexedDB hydration on reload: 207.0, 236.3, 231.3, 162.7, 226.6 ms (median 226.6 ms). Unlike the earlier per-record IndexedDB experiment, this comparison persists one schema-validated snapshot containing the API results, then filters it in memory. It does not measure per-record writes or incremental synchronization.

## Method

- Same source revision plus the comparison adapter; two minified Vite production builds selected with a build-time flag.
- Same existing TanStack virtualizer, row components, route loaders, other API dependencies, and 10,000-ticket disposable PostgreSQL/markdown fixture.
- Fixture: measure/ten-thousand; 3,334 Todo, 3,333 In progress, 3,333 Done; unique creation times; default created-descending order. Local data is fetched from that API, not regenerated separately.
- T3 preview Chrome 150, macOS, 1402 × 876 CSS pixels. Local backend on 3109; read-only preview proxies on 4188 and 4189. No added network/CPU throttling.
- Reloads reset the JS heap/atom cache, retain browser asset caches, and retain IndexedDB for the local variant. Alternating order: API, local, local, API, API, local, local, API, API, local.
- Warm navigation uses two batches of five each, in local/API/API/local order. Both have already visited the overview. The API version retains its initial pages in atoms; the local version retains the full snapshot in memory.
- Readiness is a MutationObserver seeing three nonempty virtual-list containers. It is DOM readiness, not paint, INP, or time until every background request finishes.
- Scroll probe sets scrollTop at a requested 12,000 px/s for 2.5 seconds using rAF, through approximately 30,000 px of the first section. It samples expected visible row indexes, loading-indicator visibility, scrollHeight, requests and long tasks.
- First scroll runs had 117 local / 156 API samples. Both had zero missing visible DOM row indexes and zero recorded long tasks during scrolling. Local scrollHeight stayed 560,416 px; API grew from 8,960 to 36,960 px.
- Repeat scroll runs degraded to 4–18 rAF callbacks over the interval in the preview. They are retained in the raw data as throttled repeats and excluded from a speed comparison. No FPS or compositor-paint improvement is claimed.
- Raw observations: [overview-comparison-results.json](overview-comparison-results.json). Executable browser expressions: [overview-comparison-probes.js](packages/frontend/scripts/overview-comparison-probes.js).

## Why local rendering is slower

The local reload has 631–844 ms main-thread tasks around initial list rendering, despite mounting the same 29 rows. Static inspection found quadratic bookkeeping in useStableTicketKeys: for every newly encountered ticket it constructs a Set from every previously registered key. All 10,000 records enter that hook across the three sections. A local store alone does not reduce this work. Its exact contribution has not been isolated with a CPU profile or a changed-build comparison.

Next experiment: make row-key bookkeeping linear, then rerun both builds with that same change. A proper sync implementation would also need a bulk snapshot/bootstrap path rather than 200 sequential UI pages. Loading the visible slice early while hydration continues could improve first display, but would be a separate data-flow experiment.

## Scope and reproducibility

The adapter only activates with VITE_TICKET_REPLICA_PROTOTYPE=true on localhost for measure/ten-thousand. It supports the default sort and fails explicitly for other sorts or sprint filters. Other projects use the normal API. Snapshot database: PROTOTYPE-overview-comparison-v1.

This is a read-only performance experiment: no server change feed, incremental updates, account partitioning, cache freshness, logout cleanup, or mutation reconciliation. The comparison proxy rejects non-GET requests. Do not enable this flag on a normal application preview.

With the disposable fixture backend already running on 3109, build from the repository root:

```sh
VITE_TICKET_REPLICA_PROTOTYPE=false bun run --filter @projectproject/frontend build --outDir /tmp/pp-overview-10k/api-comparison-dist
VITE_TICKET_REPLICA_PROTOTYPE=true bun run --filter @projectproject/frontend build --outDir /tmp/pp-overview-10k/idb-comparison-dist
```

Run each in its own terminal with PROTOTYPE_COOKIE set to the disposable fixture's signed session cookie:

```sh
bun packages/frontend/scripts/serve-overview-comparison.ts /tmp/pp-overview-10k/api-comparison-dist 4188
bun packages/frontend/scripts/serve-overview-comparison.ts /tmp/pp-overview-10k/idb-comparison-dist 4189
```

Open /orgs/measure/projects/ten-thousand on each origin. Navigate once to warm assets; complete local bootstrap before measuring persisted reloads. For a fresh bootstrap, delete only PROTOTYPE-overview-comparison-v1 on the local comparison origin. The fixture/backend setup is reused from the earlier isolated 10,000-ticket experiment; this runner does not create it.

Validation: frontend typecheck and both production builds passed. No visual component styling changed.

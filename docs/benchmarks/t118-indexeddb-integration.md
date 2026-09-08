# T-118: IndexedDB integration remeasurement

Follow-up: [incremental persistence fix and paired production measurements](t118-indexeddb-save-fix.md).

Measured September 8, 2026 at `f62908a0eb76213e420555ae4f1b8ab6dfc9ef3a`, after merging benchmark-stack tip `e0ad10a2a` (PR #152). The sync cache removes pagination gaps during the measured scrolling workload, but does not make first display faster on localhost. Confirmed title saves were slower with sync; code inspection identifies awaited replica catch-up and snapshot persistence as added work.

## Production browser variants

All three production builds use the same merged source, virtualizer, server, and 10,000-active-ticket fixture. Only build flags differ. This isolates the client data path; it is not a fresh checkout comparison against historical PR commits.

| Variant | Replica flag | Bulk snapshot flag | Sync flag |
| --- | --- | --- | --- |
| Server pagination | false | false | false |
| Static IndexedDB snapshot | true | true | false |
| Checkpointed IndexedDB sync | true | true | true |

Flags are `VITE_TICKET_REPLICA_PROTOTYPE`, `VITE_TICKET_SNAPSHOT_PROTOTYPE`, and `VITE_TICKET_SYNC_PROTOTYPE`. Static snapshots are the earlier experiment and do not reconcile subsequent edits.

| Measurement, median | Server pagination | Static IndexedDB | IndexedDB sync |
| --- | ---: | ---: | ---: |
| Empty local cache → overview DOM ready | 332.2 ms | 680.1 ms | 683.2 ms |
| Persisted reload → overview DOM ready | 346.7 ms | 456.3 ms | 381.4 ms |
| Warm About → Backlog navigation | 40.5 ms | 42.5 ms | 40.3 ms |
| Tickets loaded at readiness | 150 | 10,000 | 10,000 |
| Initially mounted rows | 29 | 29 | 29 |
| Initial ticket data requests | 3 pages + count | 1 snapshot | 1 snapshot |
| Warm reload ticket data requests before readiness | 3 pages + count | 0 | 0 |

Five samples per variant/cache state; one unmeasured asset/backend warmup per origin. Each round rotates variant order, and each empty-cache sample is followed by a warm reload. Empty-cache runs delete only the two prototype IndexedDB databases on isolated origins after unloading the app. They do not clear browser asset caches or PostgreSQL buffers. Warm navigation uses five samples per variant; every navigation made zero API requests.

Empty-cache ranges: server 267.5–341.0 ms, static 630.3–726.9 ms, sync 654.2–776.6 ms. Warm-reload ranges: server 302.9–399.9 ms, static 376.4–567.5 ms, sync 358.8–404.4 ms. On this local connection, the sync reload is about 35 ms slower than reloading the server's first pages, while making the entire active list available.

## Fast scrolling

Three fresh-document runs per variant, requesting 12,000 px/s for 2.5 seconds through the default list. The existing probe samples mounted-row coverage, visible loading indicators, scroll extent, and requests on animation frames.

| Observation across three runs | Server pagination | Static IndexedDB | IndexedDB sync |
| --- | ---: | ---: | ---: |
| Sampled frames | 393 | 527 | 499 |
| Frames with visible loading indicator | 7 | 0 | 0 |
| Frames missing an expected mounted row | 0 | 0 | 0 |
| Additional list-page requests per run | 11 / 9 / 10 | 0 / 0 / 0 | 0 / 0 / 0 |
| Scroll extent | 8,960 → 34,160–36,960 px | Fixed 560,416 px | Fixed 560,416 px |

Sync made two background requests per run: authentication and an unchanged-checkpoint delta. These were not pagination requests. A sequential paginated list can reach its loaded end while the requested scroll continues, so the three modes do not traverse identical ticket IDs. These measurements show data availability and DOM coverage, not compositor paint or an FPS/INP guarantee.

## Confirmed title saves: regression

Real production ticket-detail UI, actual PATCH and GET requests, warm project cache, fixture ticket `T-10000`. Three alternating server/sync rounds, five sequential title edits per mode per round. The original title is restored after each batch. Timing starts at Enter and ends when the title input exits editing after the mutation resolves; request recording continues for 100 ms. This is confirmation latency, not the latency of typing or an optimistic first visual update.

| Measurement | Server pagination | IndexedDB sync |
| --- | ---: | ---: |
| Median confirmation, all 15 edits | 41.1 ms | 250.5 ms |
| Per-round confirmation medians | 50.4 / 37.7 / 35.4 ms | 251.3 / 218.1 / 250.5 ms |
| Median PATCH duration to response headers | 19.9 ms | 17.9 ms |
| Follow-up GETs per edit | 2 | 4 |

Both modes fetch the edited detail and tag-usage counts. Sync additionally authenticates and fetches a delta. The median gap from delta response headers to the detail refresh starting is 167.1 ms. That gap includes response processing, scheduling, and replica commit; it is not an isolated IndexedDB timing.

Code inspection identifies the extra work: `refreshReplicaAfterMutation` is awaited before the mutation resolves, and `commitTicketSyncReplica` reads/decodes and rewrites the full 10,000-ticket snapshot for a one-ticket delta. The next performance slice should remove full-snapshot persistence from each edit and avoid making UI confirmation wait for redundant catch-up after a confirmed response. Generation checks, checkpoint atomicity, and read-your-writes behavior must survive that change. No product fix is included in this measurement.

## Comparison with earlier browser claims

| Earlier report | Recorded result | Current observation |
| --- | --- | --- |
| [PR #160](https://github.com/ProjectProjectOrg/project-project/pull/160), 10k follow-up | Reload 528 → 505 ms; warm navigation 244.5 → 206.5 ms, 150 initially rendered rows | Server variant now 346.7 ms reload / 40.5 ms warm navigation, with 29 mounted rows. Later virtualization and server changes are included, so this is not a speedup attributable solely to IndexedDB. |
| [Row-key optimization](../../OVERVIEW-COMPARISON.md) | After fix: API reload 724.2 ms, IndexedDB 523.5 ms; warm navigation 42.6 / 50.1 ms | Current server/sync: reload 346.7 / 381.4 ms; warm navigation 40.5 / 40.3 ms. The earlier 400+ ms local navigation problem does not reproduce. |
| [Bulk snapshot](../../BULK-SNAPSHOT-PROTOTYPE.md) | Empty-cache first display: 200 cursor requests / 13,926.2 ms versus one bulk request / 983.3 ms | Current static/sync bulk: 680.1 / 683.2 ms. The 200-page bootstrap was not rerun; neither current local variant uses it. |
| [Frontend fanout in PR #146](t118-real-context-performance.md#frontend-save-request-fanout) | Mocked mounted-cache fixture: 14 → 2 follow-up GETs | Real detail UI: 2 GETs without sync, 4 with sync. Different mounted consumers; the extra authentication/delta requests are directly visible in the current trace. |
| [Lifecycle verification](../../CACHE-LIFECYCLE-PROTOTYPE.md) | 10,000 tickets, 29 mounted rows, zero warm-reload snapshots | Reproduced across all five sync reloads. |

Historical absolute times are references, not contemporaneous controls. Runtime, browser/machine state, viewport, and code differ. No historical percentage improvement is presented as a newly reproduced causal estimate.

## Backend PR harnesses

The original full-workload harness ran three rounds at 10,000 tickets, 100 samples, 10 warmups, and concurrency 1/8/32: 14,400 measured calls, zero failures. The recorded real-context harness patch then ran three rounds per owner/member role, 300 samples, 10 warmups, and concurrency 1/8/32 for detail, metadata updates, and body updates: 16,200 measured calls, zero failures. Both used a separate empty `measure_service_rerun` database and temporary markdown root; each harness invocation seeds and cleans its own project.

### Original broad benchmark, concurrency 8

| Operation | PR recorded before p95 | PR recorded after p95 | Current p95 |
| --- | ---: | ---: | ---: |
| Default list | 894.36 ms | 64.78 ms | 27.15 ms |
| Deep cursor | 735.32 ms | 53.97 ms | 97.88 ms |
| Filtered count | 602.21 ms | 9.04 ms | 8.90 ms |
| Common search | 629.57 ms | 23.23 ms | 23.38 ms |
| Rare search | 588.48 ms | 20.28 ms | 22.63 ms |
| Detail | 6.08 ms | 12.94 ms | 4.16 ms |
| Metadata update | 10.57 ms | 12.57 ms | 11.34 ms |
| Body update | 9.76 ms | 10.47 ms | 13.15 ms |
| Create | 2,614.21 ms | 50.67 ms | 32.09 ms |

Each cell is the median of three round p95 values. Historical source: [original full-workload report](t118-ticket-performance.md). Its baseline creation failures make that row unsuitable for a success-population speedup. The historical run used Bun 1.3.13; this run uses 1.4.2 and includes later backend fixes. Deep-cursor p95 is worse than the recorded optimized result and varied from 44.04 to 113.93 ms across current rounds. The large list/count gains over the old pre-index baseline remain apparent; this is not a claim that every optimized path became faster.

### Real authorization/context, concurrency 8

| Role / operation | PR post-rebase recorded p95 | Current p95 | Current round p95 range |
| --- | ---: | ---: | ---: |
| Owner detail | 8.91 ms | 15.58 ms | 14.30–18.42 ms |
| Owner metadata update | 16.93 ms | 58.23 ms | 33.96–277.21 ms |
| Owner body update | 15.29 ms | 43.55 ms | 24.20–93.28 ms |
| Member detail | 10.38 ms | 29.93 ms | 11.93–53.38 ms |
| Member metadata update | 16.63 ms | 41.74 ms | 41.45–42.14 ms |
| Member body update | 15.84 ms | 27.38 ms | 17.85–34.53 ms |

These historical values come from the [post-rebase report](t118-real-context-performance.md#post-rebase-re-measurement), which uses the same Bun version as this run. The current run does **not** reproduce those low absolute latencies. Large tail variation remains visible; no outlier rounds were removed. The services measured here do not execute browser IndexedDB code. The merge's only difference in the underlying backend Layers/Services versus stack tip is exporting `indexEntryToTicket` for the sync handlers; the existing service implementations are otherwise identical.

The broad harness mocks authorization/configuration and attachment work, whereas the real-context patch includes them. Neither includes HTTP/session middleware or browser rendering. The fixture sync trigger is scoped to `measure/ten-thousand`, so these separate backend harnesses do not quantify change-log trigger overhead. Both production browser variants above share the same trigger-enabled backend, isolating their client-side difference.

### Fresh stack-tip control

To investigate the historical mismatch, the same real-context harness was copied into a detached worktree at stack tip `e0ad10a2a`. Both revisions used the installed dependency set, database, and fixture root. Three alternating top/merged, merged/top, top/merged rounds per role, 300 samples per operation at concurrency 8: 10,800 more measured calls, zero failures.

| Role / operation | Stack tip p95 | Merged branch p95 |
| --- | ---: | ---: |
| Owner detail | 90.88 ms | 28.13 ms |
| Owner metadata update | 103.66 ms | 46.28 ms |
| Owner body update | 76.22 ms | 47.18 ms |
| Member detail | 64.65 ms | 42.06 ms |
| Member metadata update | 98.99 ms | 53.64 ms |
| Member body update | 225.24 ms | 66.26 ms |

These medians must **not** be read as sync-engine speedups. During this control the workstation had load averages of 16.11 / 11.49 / 8.28 on 10 logical CPUs, with unrelated browser/rendering activity consuming CPU. Stack-tip owner-detail round p95 ranged from 32.97 to 178.01 ms; merged owner-detail ranged from 24.65 to 116.41 ms. The control also fails to reproduce the historical lows, despite unchanged service implementations. This establishes a substantial environmental confound, not an isolated explanation for every timing difference. A quiet-machine rerun is needed before making backend latency-regression or capacity claims. All 41,400 backend calls across the three experiments succeeded.

## Environment and reproduction

Apple arm64, 10 logical CPUs, Bun 1.4.2, Effect 4.0.0-rc.112, T3 preview Chrome 150.0.7871.224, observed viewport 1402 × 877. Disposable PostgreSQL 16 on localhost:55439, fixture backend on 3110, three isolated proxies on 4196/4197/4198. No network or CPU throttling. No builds/tests/service benchmarks overlapped browser measurements. Production builds passed for all three variants.

Build each variant with the flags above:

```sh
VITE_TICKET_REPLICA_PROTOTYPE=true VITE_TICKET_SNAPSHOT_PROTOTYPE=true VITE_TICKET_SYNC_PROTOTYPE=true \
  bun run --filter @projectproject/frontend build --outDir /tmp/pp-overview-10k/rerun-sync-dist
```

Serve with `packages/frontend/scripts/serve-overview-comparison.ts` against the disposable authenticated backend. Disable lifecycle fault instrumentation and auth writes. Title-save probes require the fixture-only ticket-write option. For cache resets, the temporary proxy adds `/__benchmark_blank`, an empty same-origin HTML document, so active IndexedDB connections are closed before deletion.

Load/navigation/scroll probes: `packages/frontend/scripts/overview-comparison-probes.js`. Title-save probe: `packages/frontend/scripts/overview-mutation-probe.js`. The latter is guarded to localhost comparison ports and restores the original title in `finally`.

For backend reproduction, use a dedicated empty database with the current schema and an empty temporary fixture directory. Repeat each command for rounds 1–3; run the real-context command separately for `owner` and `member`:

```sh
DATABASE_URL="$BENCHMARK_DATABASE_URL" PROJECTS_DIR="$BENCHMARK_FIXTURES" \
  bun packages/backend/scripts/benchmark-ticket-request-paths.ts \
  --tickets 10000 --samples 100 --concurrency 1,8,32 --variant merged-sync --round 1 --json

cp packages/backend/scripts/benchmark-ticket-request-paths.ts packages/backend/scripts/.benchmark-real-context.ts
patch --batch packages/backend/scripts/.benchmark-real-context.ts < docs/benchmarks/t118-real-context-harness.patch
DATABASE_URL="$BENCHMARK_DATABASE_URL" PROJECTS_DIR="$BENCHMARK_FIXTURES" BENCHMARK_ROLE=owner \
  bun packages/backend/scripts/.benchmark-real-context.ts \
  --tickets 10000 --samples 300 --concurrency 1,8,32 \
  --operation detail,update-metadata,update-body --variant merged-sync-owner --round 1 --json
```

For the fresh control, copy that exact patched harness into the stack-tip checkout and use concurrency 8 in both revisions, alternating the order described above. Remove temporary harness copies after measurement.

Raw samples are retained in gitignored `.benchmark-results/indexeddb-2026-09-08/`: `browser.json`, `navigation.json`, `scroll-all.json`, `mutations.json`, and backend JSONL rounds. The interrupted initial cache-reset attempt was fixed by unloading an old fixture tab before the measured load batches. Three origin warmups and a preliminary server-only five-edit probe (156.3 / 57.9 / 55.7 / 44.6 / 40.9 ms) are separate from the balanced measurement batches. No completed samples from those balanced batches were discarded.

# Effect IndexedDB ticket prototype

Branch: `prototype/ticket-indexeddb`, stacked on `prototype/ticket-overview-virtual`.

Run from `packages/frontend`:

```sh
bun scripts/run-indexeddb-prototype.ts
```

Open http://127.0.0.1:4187 and wait for PASS in the page title. Reload to verify persistence. The runner builds a minified browser bundle once; restart it after editing.

Uses first-party `@effect/platform-browser@4.0.0-rc.112`, the application's real Ticket schema, and 10,000 synthetic metadata records. Dedicated database: `PROTOTYPE-projectproject-tickets-rc112-v1`. No server or PostgreSQL connection is used.

## Measurements

T3 preview browser, Chrome 150 on macOS. Seven sequential samples per read operation per run; medians below. These are isolated storage/query measurements from a minified harness, not production overview render timings or a before/after comparison.

| Operation | First run | After reload |
| --- | ---: | ---: |
| Indexed newest 50 Todo tickets | 2.6 ms | 6.9 ms |
| Read and decode all 10,000 | 131.9 ms | 286.0 ms |
| Filter/sort hydrated records in memory | 0.8 ms | 2.2 ms |
| Indexed count of 10,000 | 51.1 ms | 64.4 ms |
| Write and receive reactive update (one sample) | 2.2 ms | 3.0 ms |

Initial insertion plus cursor commit: 1,164.4 ms (one sample; fixture generation excluded). Reload recovered all records and cursor. Variance was substantial: indexed queries ranged from 1.9 to 52.1 ms across both runs. These are feasibility observations, not latency guarantees.

All 33 first-run checks and 34 reload checks passed: schema creation, indexed filtering/order/limit, typed Date round trips, reactive invalidation, atomic rollback of ticket and cursor, delete/restore, and persistence after reload.

## Implication

The primitives support a small ticket replica. Hydrating once and retaining active records in memory looks appropriate; rereading the whole store during scrolling would be expensive. Local data can remove network pagination from scrolling after bootstrap, but this experiment does not establish rendering smoothness.

The overview is not connected to this store yet. Snapshot/delta synchronization, tombstones, account isolation/logout cleanup, reconnect behavior, cross-tab notifications, and schema upgrades remain untested/unimplemented. Reactive notification here uses explicit `.invalidate()` within the same Effect runtime.

Raw browser reports are in `indexeddb-prototype-results.json`, preserving both runs.


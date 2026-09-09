# T-142: concurrent Everhour sprint lookup

Measured locally on 2026-09-09. The application change adds concurrency 8 to
`EverhourTimeTracking.loadSprints`, matching `Groups.list`. Authorization gates,
Everhour calls, missing-document handling, filtering, and result ordering are
unchanged. Effect's concurrent `forEach` preserves input order, including the
first-match behaviour of sprint resolution.

## Method

Adapted the [T-118 setup](t118-ticket-performance.md): unique temporary markdown
directory, real document and Markdown services, 10 warm-ups and 100 measured
samples per variant per round. Three rounds run sequential/concurrent,
concurrent/sequential, sequential/concurrent. No validation commands were run
alongside the measurements.

The fixture contains 100 synthetic groups: 80 sprints and 20 epics, each with 20
ticket IDs. Markdown bodies follow T-118's 4/16/64 KiB distribution. This represents
a project with accumulated sprint history, not a measured production corpus.
Every lookup lists IDs, reads all documents, filters sprints, and resolves T-1 to
G-1. The harness also records peak active document reads.

The benchmark reproduces the local read loop with concurrency 1 or 8 and uses
real `GroupDocs` and `Markdown` layers plus the application's sprint resolver.
It does not invoke the full Everhour service or measure authorization, PostgreSQL,
remote Everhour calls, HTTP, or browser rendering. T-118's existing request
benchmark mocks group reads, so its published request timings are not a direct
baseline for this operation.

Environment: macOS arm64, 10 logical CPUs, Bun 1.4.2, local temporary filesystem
on a shared development workstation. Warm filesystem cache; no artificial I/O
delay. Scratch data is removed on completion or failure.

## Results

| Round | Read concurrency | Peak active reads | p50 ms | p95 ms | p99 ms | Lookups/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 1 | 6.59 | 8.60 | 11.22 | 145.49 |
| 1 | 8 | 8 | 4.45 | 6.40 | 8.27 | 211.27 |
| 2 | 8 | 8 | 5.55 | 8.40 | 11.79 | 163.29 |
| 2 | 1 | 1 | 8.90 | 12.11 | 13.51 | 107.63 |
| 3 | 1 | 1 | 8.96 | 12.35 | 15.31 | 105.60 |
| 3 | 8 | 8 | 5.47 | 7.94 | 17.91 | 160.79 |

All 600 measured lookups succeeded. Median per-round p50 improved from 8.90 to
5.47 ms; median p95 improved from 12.11 to 7.94 ms (about 34%). Round 3's p99 was
worse with concurrency, so these results do not establish a uniform tail-latency
improvement. They support bounded parallel reads locally, not an end-to-end or
hosted performance claim.

## Reproduce

From the repository root:

```sh
mkdir -p .benchmark-results
bun packages/backend/scripts/benchmark-sprint-lookup.ts 100 > .benchmark-results/t142-sprint-lookup.json
```

The positional argument sets the group count. `BENCH_SCRATCH_PARENT` optionally
selects an existing scratch parent; the script always creates and removes its own
unique child directory. Do not use production or daily-driver storage without
explicit authorization. The raw report is gitignored.

The benchmark results are saved here; posting them as a comment on T-142 remains
pending.

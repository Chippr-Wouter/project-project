# T-118 ticket performance benchmark

Ticket-detail follow-up: [isolated reruns and the subsequent optimization](t118-ticket-detail-performance.md). The figures below describe the original PR revision.

Measured on 2026-09-07 against the latest `main`, after rebasing the performance commits.

## Method

- Before: `bde242eccf5799db9e974147bb8b816fd183385b` (`main`).
- After: `52415a8ae` (performance branch, including optimistic-update fixes and rebase integration).
- Same request benchmark harness copied into a detached baseline worktree; only the implementation under test changes.
- 10,000 seeded markdown tickets and matching index rows per run; deterministic statuses, tags, assignees, branches, and search needles.
- 100 measured samples per operation and concurrency, following 10 warm-up calls. Concurrency: 1, 8, 32.
- Three rounds in the order before/after, after/before, before/after. Each run recreates and removes its own project fixture.
- macOS arm64, 10 logical CPUs, Bun 1.3.13; PostgreSQL 16 in a disposable Docker container bound to localhost, with temporary local markdown files.
- Both implementations use the candidate database schema. Baseline code ignores the extra counter column.
- This is a shared development workstation with background activity. The first baseline round overlapped the initial typecheck; subsequent rounds did not run validation concurrently. Results are indicative and not a dedicated-hardware capacity claim.

These are service benchmarks, not HTTP or browser benchmarks. `Tickets`, `TicketIndex`, `TicketDocs`, `Markdown`, and PostgreSQL are real. Project authorization/configuration, group reads, attachment reconciliation/missing-ID lookup, and external integrations are mocked. HTTP decoding/encoding, browser rendering, production network/storage, and same-ticket write contention are not measured. Concurrent mutation samples target distinct ticket IDs.

Each table cell is the **median of three per-round values**. p95 includes successful samples only; throughput is successful operations divided by total workload wall time. Failure counts are summed across all three rounds. The built-in comparison command intentionally rejects reports with failed samples, so this summary aggregates the raw reports directly to retain the baseline allocation failures.

## Representative results

| Operation (concurrency 8) | Before p95 (ms) | After p95 (ms) | Change |
| --- | ---: | ---: | ---: |
| Default list | 894.36 | 64.78 | -92.8% |
| Deep cursor page | 735.32 | 53.97 | -92.7% |
| Filtered count | 602.21 | 9.04 | -98.5% |
| Common search | 629.57 | 23.23 | -96.3% |
| Rare search | 588.48 | 20.28 | -96.6% |
| Ticket detail | 6.08 | 12.94 | +112.8% |
| Metadata update | 10.57 | 12.57 | +18.9% |
| Body update | 9.76 | 10.47 | +7.3% |
| Body update with mentions | 171.73 | 16.88 | -90.2% |
| Create | 2,614.21 | 50.67 | See failure counts |

The candidate had **0 failed samples out of 14,400**. Baseline create failures were **0/300 at concurrency 1, 26/300 at concurrency 8, and 150/300 at concurrency 32**, all from exhausting the filename-allocation retry limit. Creation p95 therefore describes successful calls only; it is not a like-for-like success-population speedup. All other baseline workloads had zero failures.

Point paths regress in this fixture: at concurrency 8, detail p95 is 6.08 → 12.94 ms, metadata update 10.57 → 12.57 ms, and body update 9.76 → 10.47 ms. Atomic writes add filesystem operations, but this experiment does not isolate the cause of each regression. The large gains are in project-wide queries, mention validation, and allocation; this is not an across-the-board latency reduction.

## All workloads

### Concurrency 1

| Operation | Before p95 ms | After p95 ms | Before ops/s | After ops/s | Failures before / after (of 300) |
| --- | ---: | ---: | ---: | ---: | ---: |
| list-default | 130.40 | 20.46 | 11.94 | 74.09 | 0 / 0 |
| list-deep-cursor | 101.62 | 29.74 | 15.09 | 40.28 | 0 / 0 |
| list-filter-status | 72.26 | 7.10 | 16.71 | 175.86 | 0 / 0 |
| list-filter-tag | 61.41 | 8.78 | 18.84 | 173.88 | 0 / 0 |
| list-filter-assignee | 61.23 | 7.06 | 18.16 | 192.77 | 0 / 0 |
| list-archived | 68.90 | 4.97 | 17.14 | 258.58 | 0 / 0 |
| list-filter-group | 29.64 | 7.75 | 39.18 | 157.86 | 0 / 0 |
| count-filtered | 103.34 | 4.44 | 15.28 | 282.54 | 0 / 0 |
| search-common | 61.58 | 11.39 | 18.04 | 102.26 | 0 / 0 |
| search-rare | 116.18 | 12.27 | 13.68 | 94.98 | 0 / 0 |
| search-empty | 72.69 | 12.21 | 18.50 | 97.98 | 0 / 0 |
| detail | 2.15 | 4.98 | 909.48 | 272.42 | 0 / 0 |
| update-metadata | 4.42 | 9.41 | 353.36 | 181.21 | 0 / 0 |
| update-body | 5.25 | 5.23 | 275.57 | 267.90 | 0 / 0 |
| update-body-with-ticket-mentions | 26.00 | 7.98 | 43.18 | 154.43 | 0 / 0 |
| create | 31.16 | 11.05 | 35.57 | 153.72 | 0 / 0 |

### Concurrency 8

| Operation | Before p95 ms | After p95 ms | Before ops/s | After ops/s | Failures before / after (of 300) |
| --- | ---: | ---: | ---: | ---: | ---: |
| list-default | 894.36 | 64.78 | 12.17 | 258.78 | 0 / 0 |
| list-deep-cursor | 735.32 | 53.97 | 15.40 | 181.91 | 0 / 0 |
| list-filter-status | 573.51 | 16.42 | 19.72 | 643.50 | 0 / 0 |
| list-filter-tag | 630.29 | 12.96 | 18.76 | 858.61 | 0 / 0 |
| list-filter-assignee | 685.73 | 13.60 | 18.52 | 795.59 | 0 / 0 |
| list-archived | 671.49 | 13.48 | 18.20 | 843.14 | 0 / 0 |
| list-filter-group | 290.78 | 15.21 | 44.06 | 641.42 | 0 / 0 |
| count-filtered | 602.21 | 9.04 | 19.08 | 1,241.84 | 0 / 0 |
| search-common | 629.57 | 23.23 | 16.81 | 409.87 | 0 / 0 |
| search-rare | 588.48 | 20.28 | 16.60 | 469.22 | 0 / 0 |
| search-empty | 611.79 | 20.30 | 18.61 | 479.53 | 0 / 0 |
| detail | 6.08 | 12.94 | 2,021.99 | 1,059.87 | 0 / 0 |
| update-metadata | 10.57 | 12.57 | 998.33 | 856.96 | 0 / 0 |
| update-body | 9.76 | 10.47 | 1,083.22 | 988.04 | 0 / 0 |
| update-body-with-ticket-mentions | 171.73 | 16.88 | 55.01 | 648.32 | 0 / 0 |
| create | 2,614.21 | 50.67 | 6.30 | 355.56 | 26 / 0 |

### Concurrency 32

| Operation | Before p95 ms | After p95 ms | Before ops/s | After ops/s | Failures before / after (of 300) |
| --- | ---: | ---: | ---: | ---: | ---: |
| list-default | 2,746.07 | 116.54 | 14.03 | 377.78 | 0 / 0 |
| list-deep-cursor | 2,372.23 | 204.14 | 15.25 | 165.90 | 0 / 0 |
| list-filter-status | 1,922.84 | 64.49 | 19.56 | 558.84 | 0 / 0 |
| list-filter-tag | 1,769.17 | 46.72 | 20.59 | 761.52 | 0 / 0 |
| list-filter-assignee | 1,944.03 | 47.20 | 19.43 | 735.01 | 0 / 0 |
| list-archived | 1,942.98 | 54.96 | 19.10 | 712.12 | 0 / 0 |
| list-filter-group | 906.40 | 57.29 | 39.50 | 603.03 | 0 / 0 |
| count-filtered | 2,035.70 | 29.09 | 18.74 | 1,161.71 | 0 / 0 |
| search-common | 2,514.39 | 82.47 | 15.30 | 420.81 | 0 / 0 |
| search-rare | 1,746.81 | 74.01 | 19.75 | 459.41 | 0 / 0 |
| search-empty | 1,916.51 | 75.97 | 19.28 | 457.95 | 0 / 0 |
| detail | 22.35 | 36.32 | 1,761.21 | 942.44 | 0 / 0 |
| update-metadata | 36.77 | 42.50 | 1,006.45 | 944.66 | 0 / 0 |
| update-body | 29.71 | 40.96 | 1,177.73 | 960.16 | 0 / 0 |
| update-body-with-ticket-mentions | 563.35 | 61.51 | 58.28 | 567.17 | 0 / 0 |
| create | 8,532.61 | 80.83 | 2.06 | 464.53 | 150 / 0 |

## Raw output

Raw JSON/JSONL results are local artifacts and are not committed. Keep new runs in the gitignored `.benchmark-results/` directory; retain all rounds and failures when comparing results.

## Reproduce

Use a disposable PostgreSQL database migrated with this branch, plus an empty temporary `PROJECTS_DIR`. Do not point the benchmark at a production database or markdown directory.

Create a detached worktree at the before commit and copy `benchmark-ticket-request-paths.ts` and `ticket-benchmark-report.ts` from this branch into its `packages/backend/scripts/`. Make the same installed dependencies available to both checkouts. Run from each checkout's `packages/backend`:

```sh
mkdir -p ../../.benchmark-results
DATABASE_URL="$BENCH_DATABASE_URL" PROJECTS_DIR="$BENCH_PROJECTS_DIR" \
  bun scripts/benchmark-ticket-request-paths.ts \
  --tickets 10000 --samples 100 --concurrency 1,8,32 \
  --variant before --round 1 --json >> ../../.benchmark-results/before.jsonl
```

Use `--variant after` in the candidate checkout. Repeat for rounds 2 and 3, alternating order as described above. Aggregate each operation/concurrency's p95 and throughput with the median; sum failures. If both variants have no failed samples, `benchmark-ticket-compare.ts --before ../../.benchmark-results/before.jsonl --after ../../.benchmark-results/after.jsonl` provides the comparison directly. With failed samples it intentionally stops, so retain and inspect the raw failure evidence instead of suppressing it.

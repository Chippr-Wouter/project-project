# T-118: authorization and edit latency measurements

Compared `7ede7e5feb373c4715e630825a3303ad31231880` (before) with `2dd8e9790c36602b610e651ed6d02769a0085a68` (after), on 2026-09-07. This isolates the latest authorization reuse, metadata reconciliation, and cache invalidation changes.

## Method

Local Apple arm64, 10 logical CPUs, Bun 1.3.13, disposable PostgreSQL 16 Alpine in Docker. Both revisions use the same current database schema and deterministic 10,000-ticket corpus with mixed 4/16/64 KiB bodies and branch/PR states. Three alternating rounds (before/after, after/before, before/after), 300 samples per operation/concurrency, 10 warmups. Separate explicit project owner and regular project member fixtures. No overlapping tests or compilation.

Real Tickets, Projects authorization/configuration, TicketDocs, Markdown, TicketIndex, attachment reconciliation, and PostgreSQL are included. Unlike the earlier harness, Projects and Attachments are not mocked. Bodies contain no attachment references: body edits query reconciliation state, but do not transfer objects. Unused service dependencies are stubbed. This measures service calls, excluding HTTP/session middleware, browser rendering, network RTT, and object storage.

32,400 measured requests, zero failures. Values below are medians of three per-round statistics, not pooled percentiles. Closed-loop concurrency describes throughput under this local workload, not production capacity.

## Results

These numbers were measured before the stack was rebased onto Effect v4, on Bun 1.3.13. They are retained with their original measured revisions; see [post-rebase re-measurement](#post-rebase-re-measurement) for the current code.

| Role | Operation | Concurrency | p50 ms before → after | p95 ms before → after | p95 change | requests/s before → after |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| owner | detail | 1 | 3.82 → 2.38 | 6.35 → 3.83 | -39.7% | 235.80 → 385.53 |
| owner | detail | 8 | 12.66 → 8.09 | 17.07 → 12.78 | -25.1% | 620.67 → 973.11 |
| owner | detail | 32 | 56.02 → 32.27 | 64.49 → 38.72 | -40.0% | 561.09 → 969.76 |
| owner | update-metadata | 1 | 6.52 → 6.15 | 11.63 → 35.25 | +203.1% | 146.03 → 66.58 |
| owner | update-metadata | 8 | 21.91 → 15.04 | 29.40 → 19.71 | -33.0% | 330.28 → 526.73 |
| owner | update-metadata | 32 | 111.63 → 57.92 | 173.11 → 73.40 | -57.6% | 260.00 → 510.47 |
| owner | update-body | 1 | 8.75 → 5.05 | 39.80 → 7.03 | -82.3% | 51.70 → 192.40 |
| owner | update-body | 8 | 26.46 → 15.94 | 50.77 → 26.39 | -48.0% | 269.86 → 483.66 |
| owner | update-body | 32 | 103.34 → 78.95 | 137.34 → 89.33 | -35.0% | 299.15 → 399.22 |
| member | detail | 1 | 7.65 → 3.64 | 11.44 → 6.27 | -45.2% | 123.70 → 242.19 |
| member | detail | 8 | 21.72 → 10.98 | 30.03 → 15.31 | -49.0% | 351.28 → 700.30 |
| member | detail | 32 | 105.49 → 48.72 | 127.36 → 53.55 | -58.0% | 301.18 → 652.27 |
| member | update-metadata | 1 | 8.76 → 6.48 | 12.61 → 9.81 | -22.2% | 111.06 → 144.57 |
| member | update-metadata | 8 | 29.44 → 19.53 | 39.24 → 27.95 | -28.8% | 261.30 → 388.71 |
| member | update-metadata | 32 | 124.26 → 84.01 | 142.82 → 93.60 | -34.5% | 250.72 → 375.22 |
| member | update-body | 1 | 9.30 → 6.53 | 19.52 → 9.53 | -51.2% | 94.99 → 140.68 |
| member | update-body | 8 | 33.84 → 19.40 | 50.00 → 25.39 | -49.2% | 226.94 → 403.82 |
| member | update-body | 32 | 134.56 → 92.96 | 196.42 → 113.62 | -42.2% | 230.42 → 337.57 |

Detail reads and concurrent edits improve in this experiment. Single-request writes have substantial tail variability: owner metadata p95 regresses, and large body-edit improvements should not be assumed to repeat in production. The raw rounds retain these outliers; no runs were discarded. Lower database work is independently covered by the operation-count tests in [request work](t118-request-work.md).

## Post-rebase re-measurement

The stack was rebased onto `main` after Effect v4 / Drizzle Relations v2 (#138), Better Auth 1.7 (#140), and Vite Plus (#137) landed, which also moved Bun from 1.3.13 to 1.4.2. The comparison above therefore describes code and a runtime that no longer exist. This section re-measures the rebased stack to confirm the dependency migration did not regress the write and read paths.

Measured on 2026-09-07 at the top of the rebased stack, Bun 1.4.2, Effect 4.0.0-rc.112, `drizzle-orm` 1.0.0-rc.5, local Apple arm64, 10 logical CPUs, disposable PostgreSQL 16 Alpine migrated with the current migrations. Identical configuration to the run above and the same harness patch: 10,000 tickets, 300 samples, concurrency 1/8/32, three operations, separate owner and member fixtures, three rounds each. 16,200 measured requests, zero failures. Values are medians of three per-round statistics.

This is a **single-sided** measurement: the "before" column is the previously recorded post-change number from the table above, not a fresh baseline. The delta therefore mixes the dependency migration with machine state, and `benchmark-ticket-compare.ts` deliberately refuses this pairing because the recorded `bunVersion` differs. That guard was not overridden — the table below is computed with the same median-of-per-round-statistics method, and should be read as a regression check rather than a controlled experiment.

| Role | Operation | Concurrency | p50 ms recorded → now | p95 ms recorded → now | p95 change | requests/s recorded → now |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| owner | detail | 1 | 2.38 → 2.55 | 3.83 → 4.30 | +12.3% | 385.53 → 345.31 |
| owner | detail | 8 | 8.09 → 5.91 | 12.78 → 8.91 | -30.3% | 973.11 → 1278.06 |
| owner | detail | 32 | 32.27 → 25.46 | 38.72 → 34.38 | -11.2% | 969.76 → 1204.15 |
| owner | update-metadata | 1 | 6.15 → 5.39 | 35.25 → 7.55 | -78.6% | 66.58 → 179.03 |
| owner | update-metadata | 8 | 15.04 → 11.52 | 19.71 → 16.93 | -14.1% | 526.73 → 650.72 |
| owner | update-metadata | 32 | 57.92 → 39.72 | 73.40 → 48.40 | -34.1% | 510.47 → 778.39 |
| owner | update-body | 1 | 5.05 → 5.03 | 7.03 → 7.52 | +7.0% | 192.40 → 183.34 |
| owner | update-body | 8 | 15.94 → 11.55 | 26.39 → 15.29 | -42.1% | 483.66 → 675.52 |
| owner | update-body | 32 | 78.95 → 39.50 | 89.33 → 56.43 | -36.8% | 399.22 → 776.07 |
| member | detail | 1 | 3.64 → 2.60 | 6.27 → 3.92 | -37.5% | 242.19 → 364.03 |
| member | detail | 8 | 10.98 → 6.64 | 15.31 → 10.38 | -32.2% | 700.30 → 1126.03 |
| member | detail | 32 | 48.72 → 22.50 | 53.55 → 30.03 | -43.9% | 652.27 → 1352.70 |
| member | update-metadata | 1 | 6.48 → 4.91 | 9.81 → 6.64 | -32.3% | 144.57 → 195.54 |
| member | update-metadata | 8 | 19.53 → 11.96 | 27.95 → 16.63 | -40.5% | 388.71 → 646.14 |
| member | update-metadata | 32 | 84.01 → 42.47 | 93.60 → 54.52 | -41.8% | 375.22 → 721.54 |
| member | update-body | 1 | 6.53 → 4.95 | 9.53 → 8.12 | -14.8% | 140.68 → 176.14 |
| member | update-body | 8 | 19.40 → 11.67 | 25.39 → 15.84 | -37.6% | 403.82 → 664.12 |
| member | update-body | 32 | 92.96 → 47.39 | 113.62 → 56.54 | -50.2% | 337.57 → 666.75 |

Sixteen of eighteen configurations improved, several by 30-50%. Two are higher, both at concurrency 1:

- **owner detail, concurrency 1**: 3.83 → 4.30 ms p95 (+12.3%). Per-round p95 4.23, 4.30, 4.44 (spread 0.21 ms) — consistent across rounds, so this is a real difference rather than variance.
- **owner update-body, concurrency 1**: 7.03 → 7.52 ms p95 (+7.0%). Per-round p95 6.13, 7.52, 10.18 (spread 4.05 ms) — within run-to-run variance: the spread is larger than the difference.

The single-request owner metadata outlier from the original run did not reproduce. It was recorded at 35.25 ms p95 (+203.1%) and is now 7.55 ms, below the 11.63 ms pre-change baseline, supporting the earlier conclusion that no repeatable code regression was established for it.

Raw rounds are local artifacts in the gitignored `.benchmark-results/` directory and are not committed.

## Reproduce

Apply [the harness patch](t118-real-context-harness.patch) to `packages/backend/scripts/benchmark-ticket-request-paths.ts` in each revision. Install the existing dependencies, create a disposable PostgreSQL database, and migrate it with the current migrations. Run from `packages/backend`, serially, using the order above and both roles:

```sh
mkdir -p ../../.benchmark-results
DATABASE_URL="$BENCHMARK_DATABASE_URL" PROJECTS_DIR="$BENCHMARK_FIXTURES" BENCHMARK_ROLE=owner \
  bun scripts/benchmark-ticket-request-paths.ts --tickets 10000 --samples 300 \
  --concurrency 1,8,32 --operation detail,update-metadata,update-body \
  --variant before-owner --round 1 --json >> ../../.benchmark-results/before-owner.jsonl
```

Use a dedicated empty database and fixture directory: the harness seeds and cleans its benchmark organization/user. The fixed benchmark user makes concurrent runs inappropriate.

Raw owner/member rounds are local artifacts and are not committed. Store new runs in the gitignored `.benchmark-results/` directory.

## Frontend save request fanout

Ten independent mounted-cache trials per revision, using real Effect atoms with immediate mocked HTTP responses. Each trial mounts three ticket details (two projects) and two project lists, waits for initial reads, edits one ticket, then records requests after mutation completion and 100 ms settling. Every trial made one PATCH; follow-up GETs fell from **14 to 2 (86% fewer)**. Afterward only the edited detail and its project list reload. This measures requests issued, including requests the runtime may supersede; it does not imply every old request would finish at the server.

This is a deterministic work measurement, not browser/save latency. Network delay and rendering are excluded; one authoritative detail GET is deliberately retained. Raw request recordings are local artifacts; the [measurement fixture](t118-frontend-measurement.test.ts.txt) remains versioned. Copy the fixture to `packages/frontend/src/atoms/measurement.test.ts` in each revision, generate the existing Paraglide sources, and run `NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run src/atoms/measurement.test.ts` from `packages/frontend`. All 20 trials passed.

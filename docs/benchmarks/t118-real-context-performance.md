# T-118: authorization and edit latency measurements

Compared `7ede7e5feb373c4715e630825a3303ad31231880` (before) with `2dd8e9790c36602b610e651ed6d02769a0085a68` (after), on 2026-09-07. This isolates the latest authorization reuse, metadata reconciliation, and cache invalidation changes.

## Method

Local Apple arm64, 10 logical CPUs, Bun 1.3.13, disposable PostgreSQL 16 Alpine in Docker. Both revisions use the same current database schema and deterministic 10,000-ticket corpus with mixed 4/16/64 KiB bodies and branch/PR states. Three alternating rounds (before/after, after/before, before/after), 300 samples per operation/concurrency, 10 warmups. Separate explicit project owner and regular project member fixtures. No overlapping tests or compilation.

Real Tickets, Projects authorization/configuration, TicketDocs, Markdown, TicketIndex, attachment reconciliation, and PostgreSQL are included. Unlike the earlier harness, Projects and Attachments are not mocked. Bodies contain no attachment references: body edits query reconciliation state, but do not transfer objects. Unused service dependencies are stubbed. This measures service calls, excluding HTTP/session middleware, browser rendering, network RTT, and object storage.

32,400 measured requests, zero failures. Values below are medians of three per-round statistics, not pooled percentiles. Closed-loop concurrency describes throughput under this local workload, not production capacity.

## Results

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

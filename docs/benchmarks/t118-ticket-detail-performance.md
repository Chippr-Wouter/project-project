# T-118 ticket-detail follow-up

Measured 2026-09-07. This follows the [original full-workload benchmark](t118-ticket-performance.md).

## Result

Replacing two detail-index queries with one targeted query lowers median round p95 by 27–38% across concurrency 1/8/32. Every variant in these detail-only runs completed without failed samples.

The detail handler previously resolved the index project, then loaded and decoded a full ticket-index row to get `branchDeletedAt`. It now fetches that one timestamp with a project/organization-scoped join. Authorization, markdown reads, attachment checks, and response/git-state semantics remain in place. This adds no cache or schema migration.

| Concurrency | p50 ms, before → after | p95 ms, before → after | p95 change | Successful requests/s, before → after |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0.79 → 0.52 | 1.86 → 1.15 | -38.2% | 1,052.56 → 1,643.14 |
| 8 | 2.68 → 1.58 | 4.90 → 3.59 | -26.7% | 2,771.50 → 4,499.42 |
| 32 | 12.13 → 6.46 | 14.52 → 9.85 | -32.2% | 2,638.82 → 4,524.11 |

Before: `ae627531bbe33d1031fe7fd34da5aa351fd6a57c` (original PR). After: `6a626535d3437f91bca965078e3a7fdf27c5a36b` (review fixes and narrow detail query).

Raw comparison rounds: [before](t118-detail-before.jsonl), [after](t118-detail-after.jsonl). The after variant is named `narrow` in the raw reports. Each variant has 4,500 measured requests: 500 samples × 3 concurrency levels × 3 rounds. Metrics in the table are the median of the three per-round values; percentiles are not pooled.

## Was the earlier slowdown repeatable?

The original mixed-workload run showed detail p95 at concurrency 8 increasing from 6.08 to 12.94 ms. A fresh detail-only comparison of its exact `main` revision (`bde242ecc`) and original PR did not reproduce that increase: median round p95 was 5.94 ms on main and 4.87 ms on the PR. The detail handler itself was unchanged between those revisions.

Raw diagnosis rounds: [main](t118-detail-main.jsonl), [original PR](t118-detail-original-pr.jsonl). These establish that the original 2× increase was not stable in the isolated workload; they do not identify the cause of the earlier result. Workload order, different sampled tickets, runtime state, and workstation variability differ from the mixed-workload run. The optimization comparison above uses its own alternating control rounds.

A probe that skipped index reads on tickets without a branch or with an existing PR improved throughput but worsened tail latency under the saturated mixed-ticket workload. The final implementation uses one narrow query on every detail read and improves p95 at all tested concurrency levels.

## Method

- 10,000 deterministic markdown tickets with the existing 4/16/64 KiB body distribution and mixed branch/PR states.
- Detail-only workload, 500 measured requests per concurrency per round, 10 warm-ups per concurrency, concurrency 1/8/32.
- Three alternating rounds: before/after, after/before, before/after. Runs were sequential; no typecheck or test suite ran alongside them.
- macOS arm64, 10 logical CPUs, Bun 1.3.13; disposable PostgreSQL 16 Docker container on localhost and temporary markdown fixtures.
- Same harness and database schema for both variants. The original PR ran in a detached worktree; the candidate ran in the working checkout.
- Real `Tickets`, `TicketIndex`, `TicketDocs`, `Markdown`, and PostgreSQL. Authorization/configuration, groups, attachment reconciliation/missing-ID checks, and external integrations use the existing benchmark mocks.

These are short, closed-loop service benchmarks on a shared development workstation. They exclude HTTP encoding/transport, browser rendering, real authorization/configuration queries, production storage, and same-ticket mutation contention. They measure request-path improvements, not end-to-end page-load time or production capacity.

## Reproduce

Use a disposable database with the candidate migrations applied, and an empty temporary projects root. Run from `packages/backend` in each checkout, using the candidate harness in both:

```sh
DATABASE_URL="$BENCHMARK_DATABASE_URL" \
PROJECTS_DIR="$BENCHMARK_PROJECTS_DIR" \
bun scripts/benchmark-ticket-request-paths.ts \
  --operation detail --tickets 10000 --samples 500 --concurrency 1,8,32 \
  --variant before --round 1 --json >> before.jsonl
```

Use `--variant after` and a separate output file for the candidate; repeat with rounds 2 and 3 in alternating order. Both checkouts must use the same `benchmark-ticket-request-paths.ts` and `ticket-benchmark-report.ts`. The harness seeds and cleans its own fixture. Omitting `--operation` retains the full benchmark workload.

The initial diagnostic runs used the same detail selection through a temporary harness filter; `--operation detail` now provides that selection directly. Keep every raw round when comparing medians and include failures if any occur.

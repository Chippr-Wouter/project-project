# Virtual ticket overview prototype

Question: does virtualizing ticket rows and automatically fetching subsequent
cursor pages make a large project's overview feel substantially faster?

Branch: `prototype/ticket-overview-virtual`, stacked on
`perf/ticket-overview-loading` (PR #160).

Run the existing app with `bun run --filter @projectproject/frontend dev`.
This branch enables the prototype on the existing ticket overview. It uses
the normal backend; use a disposable fixture for mutation experiments.

The prototype preserves grouped lists and their existing cursor atoms. Each
section mounts visible rows with six rows of overscan, retains a focused or
previewed row, and prefetches within 1,200 pixels of its loaded end. Normal
scrolling shows a reserved loading indicator; the button is a failure fallback.
DOM attributes expose loaded and mounted counts for browser measurements.

## Result so far

Two isolated production frontend builds against the same disposable backend,
PostgreSQL 16 database, and 10,000 active ticket fixture. Three statuses,
50 initial records per status; mixed ticket types/priorities, 25% assigned,
4/16/64 KiB bodies. No GitHub integration or sprints. Parent revision:
`89f736036cc973fbe00f2d7a536e392cf196af2e`.

Chrome 150 in T3, 1402 × 876 CSS viewport. Warm About → Backlog navigation,
two seven-sample batches per build, in parent/prototype/prototype/parent order:

| Measurement | Parent | Prototype |
| --- | --- | --- |
| Median navigation to mounted list | 265 ms | 63 ms |
| Range | 202–481 ms | 53–89 ms |
| Initially mounted ticket rows | 150 | 29 |
| API requests during navigation | 0 | 0 |

Raw parent samples: 252, 223, 207, 206, 202, 208, 203;
481, 357, 326, 313, 303, 278, 291.

Raw prototype samples: 89, 61, 63, 54, 54, 56, 54;
77, 66, 66, 63, 53, 65, 80.

Timing uses MutationObserver from click until all three sections have their
initial data and mounted rows. It measures DOM readiness, not paint or INP.
Both builds have 150 records loaded; only the mounted subset differs. These
are small local samples with visible machine variability, not production SLOs.
At the separate 1212 × 1309 interaction viewport, 37 rows mounted initially;
scrolling to 1200 px loaded the next Todo page (50 → 100) without changing
scrollTop, with 49 rows mounted across sections and no load-more button.

TypeScript and production build passed. Browser checked automatic loading,
focused-row retention, collapsed groups, and light/dark rendering.

## Deliberate prototype limits

- Scrollbar extent follows loaded pages, so its thumb changes as pages arrive.
  A stable full-count scrollbar with arbitrary jumps requires a decision on
  range/seek loading; the current backend exposes sequential cursors.
- Growing earlier sections pushes later sections farther down. Collapsing a
  section remains the way to skip it.
- Rows assume the current 52 px height and 4 px gap. Variable-height rows,
  mobile layouts, and keyboard traversal across virtual boundaries need a
  production pass before promotion.
- Focus retention keeps one index per section; mutation/reordering behavior
  and menus whose anchor leaves the viewport need further validation.
- Loaded data accumulates in the existing atom cache; virtualization bounds
  mounted components, not total cached records.
- Per-row entrance animations are omitted so scrolling does not animate
  recycled rows. No new test suite was added for this throwaway experiment.

Keep the performance finding; refine or replace this prototype before merging.

## Fast-scroll investigation

An instrumented run through already-loaded Todo records (1,150 cached) sampled
40 animation frames over approximately 2.5 seconds at a requested 12,000 px/s:
zero missing visible-row indexes and zero API requests. This checks DOM
coverage, not compositor paint. Preview idle rAF subsequently ran at roughly
1 Hz, so these runs do not establish a trustworthy FPS result.

A separate 12,000 px/s page-boundary run reproduced visible loading indicators.
At that speed the 1,200 px prefetch distance gives only 100 ms of lead time;
measured ticket-page request durations were 184, 102, 170, 103, 83, and 82 ms,
before the additional React commit time. Switching virtualizers alone cannot
remove that network/data gap.

Next experiment to consider: compare GroupedVirtuoso against TanStack with
identical fully cached rows first, then evaluate page fetching separately.
GroupedVirtuoso owns grouped layout/sticky headers and dynamic measurements;
TanStack retains more control but requires us to implement those details.
No replacement library has been installed or selected.

Sources:
- https://tanstack.com/virtual/latest/docs/framework/react/react-virtual
- https://virtuoso.dev/react-virtuoso/
- https://github.com/inokawa/virtua

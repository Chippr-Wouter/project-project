# Bulk ticket snapshot prototype

The dedicated bulk endpoint reduces the first visit with an empty local cache from **13,926.2 ms to 983.3 ms median** for 10,000 tickets (three samples each). This includes fetching, schema decoding, IndexedDB persistence, and mounting all three overview sections. The same 29 rows mount initially in both modes.

| Operation, median | 200 cursor pages | One bulk snapshot |
| --- | ---: | ---: |
| Fetch and decode | 13,618.8 ms | 463.0 ms |
| Persist to IndexedDB | 149.1 ms | 191.5 ms |
| Complete bootstrap | 13,770.4 ms | 674.1 ms |
| Navigation start to overview DOM ready | 13,926.2 ms | 983.3 ms |
| Ticket requests | 200 | 1 |

First-display samples: paginated 18,091.2 / 13,671.0 / 13,926.2 ms; bulk 1,067.0 / 983.3 / 907.5 ms. Cached bulk reloads: 408.5 / 464.8 / 682.8 ms, zero ticket requests in each.

Both paths persisted 10,000 unique IDs with identical SHA-256 of the serialized ticket array:
`3e6defa22e6a55f1202f3d432ac61ea55c82a4cba20dfae285aa243b06528a1e`.

## Implementation

GET /api/orgs/:orgSlug/projects/:slug/tickets/prototype-snapshot reuses the existing Tickets.list service with its access checks, metadata-index conversion and created-descending ordering, allowing 10,000 records per response. It returns the existing TicketListPage schema. The client refuses a non-null cursor so it cannot silently persist a truncated snapshot.

The endpoint is disabled unless TICKET_SNAPSHOT_PROTOTYPE=true and restricted to measure/ten-thousand. Unauthenticated request: 401. Authenticated request to a different project: 404. It is a fixture-specific experiment, not a complete public sync API.

Client build flag VITE_TICKET_SNAPSHOT_PROTOTYPE=true selects bulk fetching; false retains cursor bootstrap. VITE_TICKET_REPLICA_PROTOTYPE=true is required for both. Persistence, row-key optimization, virtualizer, components and initial rendering behavior are identical.

The existing list service reads the project's index before pagination; this prototype avoids repeating that work and the HTTP round trip 200 times. No ticket markdown bodies are downloaded. One full JSON response measured 3,671,981 bytes uncompressed.

## Method and limits

Minified Vite production builds, T3 Chrome 150 on macOS, 1402 × 876 viewport. Both builds use the same disposable backend on port 3110 and PostgreSQL fixture on 55439. Read-only proxies serve bulk on 4190 and paginated on 4191.

Three empty-cache runs per mode in paginated/bulk/bulk/paginated/paginated/bulk order. Only the fixture entry in PROTOTYPE-overview-comparison-v1 is removed between runs; the next navigation resets memory. First run per origin also loads its assets; later runs retain the browser asset cache. Timings include backend work and schema decoding. Fetch/decode timing is not pure network transfer time.

Readiness uses the existing MutationObserver probe: three nonempty virtual list containers. It is DOM readiness, not paint/INP. No artificial network delay or bandwidth limit was applied. A 3.7 MB transfer can cost much more on a remote connection. The prototype still waits for the entire snapshot and persistence before rendering; progressive first display is not implemented.

This is an active-ticket snapshot with the existing default archive filter, not a complete workspace replica. There is no sync checkpoint/change log yet, no incremental refresh or mutation reconciliation. Data was static during the comparison. A production bootstrap must define its consistency boundary with subsequent deltas.

Workspace typecheck and both production builds passed. Lint passed with one existing comparison-runner warning. HTTP checks verified 200 for the fixture, 401 without authentication, and 404 outside the fixture. Browser verification confirms matching persisted contents and cache reuse on reload.

Raw reports: [bulk-snapshot-results.json](bulk-snapshot-results.json). Browser probes: packages/frontend/scripts/overview-comparison-probes.js.

## Reproduce with the existing disposable fixture

Start the isolated backend with TICKET_SNAPSHOT_PROTOTYPE=true on port 3110. Build from repository root:

```sh
VITE_TICKET_REPLICA_PROTOTYPE=true VITE_TICKET_SNAPSHOT_PROTOTYPE=true bun run --filter @projectproject/frontend build --outDir /tmp/pp-overview-10k/bulk-snapshot-dist
VITE_TICKET_REPLICA_PROTOTYPE=true VITE_TICKET_SNAPSHOT_PROTOTYPE=false bun run --filter @projectproject/frontend build --outDir /tmp/pp-overview-10k/paged-snapshot-dist
```

With PROTOTYPE_COOKIE set to the disposable signed session cookie, run in separate terminals:

```sh
PROTOTYPE_BACKEND_PORT=3110 bun packages/frontend/scripts/serve-overview-comparison.ts /tmp/pp-overview-10k/bulk-snapshot-dist 4190
PROTOTYPE_BACKEND_PORT=3110 bun packages/frontend/scripts/serve-overview-comparison.ts /tmp/pp-overview-10k/paged-snapshot-dist 4191
```

Visit /orgs/measure/projects/ten-thousand. Clear only the prototype database on that comparison origin before testing an empty-cache first visit. This reuses the earlier disposable fixture; the runner does not seed it.


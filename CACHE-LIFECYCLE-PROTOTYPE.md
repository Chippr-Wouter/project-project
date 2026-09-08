# Ticket cache lifecycle prototype

This slice adds account ownership and cleanup to the checkpointed ticket replica. It remains limited to the disposable `measure/ten-thousand` fixture behind the existing prototype flags.

The cache belongs to a server, authenticated user, and project. A network failure preserves cached tickets. Confirmed logout, account switching, or lost project access revokes the corresponding cache ownership and removes its ticket data.

Revocation must also reject work already in flight. The owner generation, changed ticket records, and checkpoint are checked/written in one IndexedDB transaction, so a delayed response cannot recreate data after another tab has cleared it. In-memory results are published only after that transaction commits.

Authentication is part of this boundary: a delayed identity response must not reactivate an owner revoked since the request started. The UI must also discard previous successful atom values when identity changes, because normal background refresh intentionally retains them.

## Implementation

The first-party Effect IndexedDB modules own schema decoding and transactions. Auth and project generations are checked in the same transaction that persists changed ticket rows and checkpoint metadata. Scoped BroadcastChannel subscriptions notify other tabs. Revocation does not wait for the replica's network semaphore.

The lifecycle listener mounts above the router, including while initial route loaders are pending. Confirmed revocation hides the old view and reloads the document, disposing existing atom values and previous-success UI references. This is an intentional prototype boundary; ordinary delta synchronization does not reload the page.

The v2 database does not import earlier, unowned prototype snapshots. Authentication reads capture a generation before the request and retry a stale activation against fresh authentication. Local ticket filters use the authenticated user rather than the fixture owner's hardcoded ID.

### Effect review fixes

`TicketSync` now owns mutable cache state, generations, the semaphore, and its BroadcastChannel inside one application-scoped service. `TicketSyncStorage` opens the database once for that scope. Scope disposal closes resources and clears memory; disposed service handles reject authentication. Atoms acquire the service through the existing application runtime.

Database opening errors remain typed operation failures, so a storage failure does not prevent the application from constructing its auth workflow. Logout attempts server sign-out even when cache-token capture fails. After confirmed server sign-out, an interruption-safe finalizer resets local authentication even if cache cleanup fails. Failed server sign-out does not falsely clear authentication. Confirmed revocation also notifies the local view when its persistence transaction fails.

Deleting inaccessible IndexedDB data cannot be guaranteed. The UI still discards its old state; subsequent cache access remains subject to authentication and generation checks.

The follow-up passed workspace typechecking, a production build, eight focused unit tests, and five automated browser lifecycle cases using real IndexedDB. The browser harness was separately typechecked. New service and harness files pass lint without warnings. Production UI verification retained all 10,000 tickets with 29 mounted rows and zero snapshot requests on warm reload. Injecting an IndexedDB failure during simulated server sign-out reached `/login` with zero ticket lists. See [follow-up results](cache-lifecycle-service-results.json).

### Repeatable lifecycle tests

Run unit tests with:

```sh
bunx vp test run --project frontend packages/frontend/src/services/logout.test.ts packages/frontend/src/atoms/ticketSyncPrototype.test.ts packages/frontend/src/components/TicketList/SectionList.test.tsx
```

The browser harness uses the real service and IndexedDB, replacing only external HTTP responses. It checks delayed bootstrap/delta responses after revocation, stale authentication, independent service scopes, persisted hydration, connection disposal, and transport failures. It deletes only `PROTOTYPE-ticket-sync-v2` on its guarded test origin, `localhost:4195`; no fixture backend or credentials are needed.

```sh
bun build packages/frontend/scripts/ticket-sync-lifecycle-tests.ts --target browser --minify --tsconfig-override packages/frontend/tsconfig.json --define 'import.meta.env.VITE_TICKET_SYNC_PROTOTYPE="true"' --define 'import.meta.env.VITE_TICKET_REPLICA_PROTOTYPE="true"' --outdir /tmp/ticket-sync-browser-tests
python3 -m http.server 4195 --bind 127.0.0.1 --directory /tmp/ticket-sync-browser-tests
```

Open `http://localhost:4195`, then run in the browser console:

```js
await import('/ticket-sync-lifecycle-tests.js')
await window.runTicketSyncLifecycleTests()
```

For the production UI storage-failure check, the disposable comparison proxy supports `PROTOTYPE_SIMULATE_SIGN_OUT=true` alongside `PROTOTYPE_LIFECYCLE_HARNESS=true`. It simulates successful sign-out and subsequent unauthorized responses without changing the backend session. Restart the proxy to reset that simulation.

## Production-build verification

Use a production build in `/tmp/pp-overview-10k/lifecycle-dist`, the disposable backend on port 3110, and a separate fixture proxy on port 4193. Two real disposable accounts exercise ownership in browser tabs sharing the same origin and IndexedDB storage.

Browser checks used the T3 preview browser on September 7–8, 2026, with 10,000 tickets and two disposable accounts. Production builds were rebuilt as failures were corrected; the final build specifically rechecked the delayed bootstrap transition.

| Scenario | Observed result |
| --- | --- |
| Same-account warm reload | All 10,000 tickets available, 29 mounted rows, zero snapshot requests; delta sync resumed. One observed readiness time was 510.1 ms. |
| Transport failure | 21 failed polls; all 10,000 cached tickets remained visible. Recovery resumed successful auth and delta requests. |
| Account A → B, two tabs, B bootstrap held | Zero previous-account rows visible and zero persisted snapshots before releasing B's bootstrap. Both tabs then loaded B's 10,000 tickets. |
| Project membership removed | Three tabs removed cached rows and showed project-not-found, including one tab with incoming broadcasts suppressed. Restoring membership and reloading restored 10,000 tickets. |
| Logout while responses were held | Both ordinary tabs reached login and the snapshot/project stores became empty before the held responses were released. |
| Successful nonempty delta released after logout, broadcasts suppressed | Returned to login; no old tickets reappeared. |
| Successful identity response released after logout, broadcasts suppressed | Returned to login; stale authentication did not reactivate the cache. |
| Successful cold bootstrap released after logout, broadcasts suppressed | Final production build returned to login with zero rows. Snapshot and project stores remained empty. |

The 510.1 ms value is a single observation, not a repeated before/after performance benchmark. The main acceptance criterion here is ownership and revocation correctness.

Review and browser verification caught two material draft failures: a tab could retain visible cached rows after another tab had already removed the persisted snapshot, and a delayed initial bootstrap reached a React error boundary because its lifecycle listener had not mounted. Both were corrected and their failing scenarios rerun successfully.

Validation also passed the workspace typecheck, production build, and focused delta/virtual-list tests (two files, three tests). Changed TypeScript files have no lint errors; existing lint/typecheck suggestions remain elsewhere. Browser observations are recorded in [cache-lifecycle-results.json](cache-lifecycle-results.json).

The fixture proxy injects disposable credentials without changing the browser's normal login cookie. Response delays belong to the test harness, not the app.

`packages/frontend/scripts/setup-cache-lifecycle-fixture.mjs` prepares the second fixture account and writes private proxy environment variables. It requires an explicitly supplied disposable `PROTOTYPE_DATABASE_URL` and signing secret (or existing cookies), validates the fixture identity, and supports `--cleanup` using its recorded baseline. `cache-lifecycle-probes.js` supplies bounded browser inventory and network probes. Enable `PROTOTYPE_LIFECYCLE_HARNESS=true` for response controls; auth writes require `PROTOTYPE_ALLOW_AUTH_WRITES=true`. The test restored the removed membership and changed ticket title. All database mutations were confined to the disposable fixture.

## Remaining boundaries

- Both prototype flags and localhost are required; project scope remains `measure/ten-thousand`.
- This is cache lifecycle, not offline login, offline writes, or general synchronization of memberships and related entities. Remote revocation is discovered on the next successful authorization check; a network outage cannot prove access was revoked.
- Auth/access changes reload the document. Replacing that with targeted disposal needs account-scoped ownership throughout the existing atom graph.
- BroadcastChannel provides prompt cross-tab cleanup. Persisted generations guard delayed commits and catch missed notifications on subsequent checks; a dormant tab that misses notifications is not guaranteed immediate cleanup.
- Storage eviction/recreation, quota recovery, schema migration across releases, and old v1 database removal need a separate storage-lifecycle slice before promotion.
- Snapshots still persist as whole records; this slice does not reduce the cost of large nonempty deltas.

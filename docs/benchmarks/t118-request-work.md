# T-118: reducing repeated request work

Follow-up to the [ticket-detail latency benchmark](t118-ticket-detail-performance.md), compared with `7ede7e5fe`.

This change targets work excluded from the service latency harness: real authorization/configuration lookups, attachment reconciliation, and frontend cache invalidation. The evidence below counts calls through the real services/atoms with instrumented database/HTTP dependencies. It is not an additional latency measurement; the earlier millisecond figures describe their recorded revisions.

| Operation | Before | After |
| --- | ---: | ---: |
| `Projects.getGithubIntegration`, explicit project owner | 6 database calls | 4 database calls |
| Same, project member or inherited org admin | 7 database calls | 5 database calls |
| Metadata-only ticket edit | 1 attachment reconciliation | 0 |
| Edited project's list fetches after one edit in the mounted-cache fixture | 3 | 1 |

The authorization helper now returns the project row it already loaded alongside the verified role. Project reads, key reads, and integration reads reuse it within the same call. Ticket detail reads and updates rely on the integration method's authorization instead of calling membership checks separately first. This also removes another 3–4 access queries from those ticket paths, depending on the user's role. Authorization results are not cached across requests.

Ticket edits only reconcile attachment references when a body is supplied. Body edits still reconcile under the existing ticket lock, including an explicitly empty body.

Effect Reactivity treats an array as independent invalidation keys, not a composite key. The old `["tickets", orgSlug, slug]` therefore matched unrelated ticket caches and could trigger the same subscription multiple times. Ticket invalidations now use one project-specific key, with a separate project-list key for ordinary field updates. All existing ticket invalidators in git, sprint, tag, status, and project mutations use the matching key.

The frontend fixture mounts the edited ticket, another ticket in its project, a ticket in another project, and both project lists. After the edit, it records exactly two GETs: one authoritative detail read and one edited-project list read. Neither unrelated detail nor the other project's list is refetched. The mutation response is not used to replace the authoritative read: retaining that read preserves reconciliation with overlapping saves and server changes.

## Verification

- `Layers/Projects.access.test.ts` exercises owner, member, inherited admin, and denied access through the real Projects service. Denied access still returns NotFound without reading integration data.
- `Services/Tickets.test.ts` verifies metadata edits skip reconciliation and body edits retain it.
- `atoms/tickets.test.ts` drives real mutation/read atoms with mocked HTTP, verifies request counts, and retains pending-edit, rollback, and subsequent-server-update coverage.
- Running the new authorization and invalidation checks against the prior implementation reproduces the excess calls; they pass with this change.

Run from the corresponding package directories:

```sh
# packages/backend
../../node_modules/.bin/vitest run src/Layers/Projects.access.test.ts src/Services/Tickets.test.ts

# packages/frontend
NODE_OPTIONS=--no-experimental-webstorage ../../node_modules/.bin/vitest run src/atoms/tickets.test.ts
```

Follow-up: [real authorization and edit latency measurements](t118-real-context-performance.md) now measure these revisions with real PostgreSQL-backed project and attachment services, plus before/after frontend request counts.

# GitHub integration reference

T3 Code is available as a source-only checkout at
`opensrc/repos/github.com/pingdotgg/t3code`.

- Upstream: https://github.com/pingdotgg/t3code
- Reviewed commit: `0d34579d674920cc47fc5c908494f51ed3895204`
- Fetched from the default branch on 2026-09-07.

To recreate the checkout when it is absent:

```sh
git clone --depth 1 https://github.com/pingdotgg/t3code.git opensrc/repos/github.com/pingdotgg/t3code
```

Do not install its dependencies or run its scripts as part of ProjectProject.
`opensrc/` is excluded from Git, Docker build contexts, lint, and formatting.
Workspace discovery and Vitest projects are scoped to `packages/*`; package
TypeScript projects include only `src`. Bun's native test discovery is also
scoped to `packages/`. The supported project test command remains `bun run test`.

## Patterns used

- `apps/server/src/git/GitManager.ts`: repository-aware head matching, preference
  for open PRs, and reuse of an existing PR before creating one.
- `apps/server/src/sourceControl/gitHubPullRequests.ts`: runtime decoding of
  GitHub responses before using their contents.
- `apps/server/src/sourceControl/GitHubCli.ts`: bounded requests and deliberate
  handling of remote failures.

ProjectProject keeps its Octokit REST/GraphQL transport and GitHub App
installation authentication. User-initiated branch and PR creation retains the
existing user-token attribution. No GitHub CLI dependency is introduced.

Automatic matching applies to a ticket's attached branch in its connected
repository. A PR created directly on GitHub can be discovered without creating
it through ProjectProject. Forks with the same branch name are excluded.

## Branches created outside ProjectProject

The existing project GitHub refresh also discovers pushed branches in the
connected repository. While the project is visible, the frontend refreshes every
60 seconds and on focus. Local-only branches become discoverable after a push.

An unlinked, active ticket can acquire a branch containing its ID, such as
`feat/PP-123-add-search`. Matching is case-insensitive, so branches created
outside ProjectProject match too (`feat/pp-123-add-search`, `Pp-123/add-search`).
IDs must be separated from surrounding letters and digits, so slashes, dashes,
dots, and brackets all count as boundaries. Only branches carrying a well-formed
ID are fetched for pull-request state. Matching is scoped to the project and
repository; the default branch is excluded. Multiple candidate branches,
multiple ticket IDs in one branch, and branches already attached to any ticket
in another connected project require manual attachment. Repository ownership
uses GitHub's stable repository ID across organizations. Broken connections
retain ownership; disconnected connections do not. Manual attachment remains
allowed, including when another ticket already uses the branch.
Because matching ignores case, branches differing only in the case of the ID
count as multiple candidates and are left for manual attachment.
Existing links are never replaced. PR discovery runs for newly linked branches too.

Discovery uses GitHub's name query and scans at most ten pages of 100 branches.
If more pages remain, the scan fails without linking from an incomplete set;
an unseen page could contain another candidate. Previously fetched state can
still be shown as stale.

Explicit unlink writes `branchAutoLinkDisabled: true` into the ticket's markdown.
Refresh respects this flag, and ordinary ticket edits preserve it. Manually
attaching or creating a branch clears the flag. This preference is private document
metadata; it does not require a database migration or public API change.

## Refresh reliability and PR details

Project-state reads share a bounded 15-second cache and in-flight requests.
Repository mutations and GitHub App webhooks invalidate the affected cache.
The cache and request cooldowns belong to application-owned Effect layers;
HTTP handlers, webhooks, and MCP share those instances. Separate application
instances have separate state. App JWT requests share an app cooldown;
installation and user tokens have separate scopes. Rate-limit errors retain
their typed reset time through the API, including during a cooldown. Octokit
owns installation-token caching and concurrent token-request deduplication.

Transient failures retain the last successful snapshot when available, otherwise
fall back to the ticket's persisted Git metadata. API responses mark stale data
and rate limits explicitly. Stale snapshots never attach branches or change
ticket status. The frontend refreshes affected ticket caches when branch/PR
metadata changes, alongside the Git badges.

Ticket edits, Git reconciliation, and webhook writes share application-owned
ticket locks, covering the read, markdown write, and index update. Automatic
link checks and branch attachment writes also share repository locks so
concurrent scans cannot claim the same branch. This coordinates writers within
one backend process; external file editors and multiple backend processes do
not participate in those locks. Cached observations cannot overwrite newer
ticket metadata.

The UI retains its original Git badges, aggregate check status, branch
selection, and create/connect controls. Detailed review, conflict, and check
enrichment is deferred together with its UI. Workflow status automation remains
unchanged.

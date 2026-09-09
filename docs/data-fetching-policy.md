# Data-fetching ownership policy

T-139, supporting T-137. Decisions agreed in discussion on 2026-09-09.
Wouter's approval comment on T-139 and the link from T-137 remain pending.

## Ownership and route readiness

Routes initiate reads through canonical resource atoms in the shared registry.
Atoms own cached server state and optimistic updates; components subscribe and
render. Loaders must not create a second owner by calling the same API outside
that cache.

Layout loaders may initiate cheap data needed by shared, visible chrome. Reads
specific to a page belong to that page. Intent preloading runs loaders on hover,
so placing reads in a parent layout multiplies speculative work across its child
destinations. Ticket detail must not fetch backlog counts solely for hidden tabs.
Shared metadata needed by visible controls remains legitimate demand.

Page loaders start independent reads together once their inputs are known. Mount
reads without awaiting them unless their result determines authentication,
access, existence, or a redirect. Preserve genuine permission prerequisites.
Components remain able to start a missing read if router loader data is reused
after its atom has expired.

The ticket description and comments are both core ticket content. Start them
together, including during ticket hover prefetch, and render each as it becomes
ready. Time tracking and GitHub data load independently and never block core
content. Keep loading, empty, failed, and refreshing states distinct at the owning
section; a failed refresh must remain visible even when retaining previous data.

## Backlog and control demand

| Surface | Policy |
| --- | --- |
| Backlog sections | Eagerly load the first page for matching statuses, including collapsed sections. Further pages load on demand. |
| Small, frequently used picker datasets | Load statuses, tags, and members early and reuse their canonical caches. |
| Remote search | Prefetch initial suggestions on hover/focus; opening or activating a control must also work without a prior hover. Debounce typed searches and prevent superseded results from replacing current results. Interrupt superseded work where supported. |
| Occasional administrative data | Fetch on intent toward, or opening of, the relevant management control. Tag usage counts belong here. |

The current backlog already returns counts and first pages together through
`tickets.sections`, including collapsed statuses. Preserve this behaviour; no
separate visible-versus-collapsed scheduling mechanism is required. The earlier
T-137 audit describes an older per-section loading implementation.

Prefetch only the destination's relevant view: sprint description does not need
board tickets. Closed controls do not justify fetching every possible search
candidate or optional integration dataset.

## Retention, freshness, and loader lifetime

Idle TTL governs retention of unused atom nodes. It is not a freshness policy and
does not periodically refetch mounted data. Keep freshness explicit: mutations
refresh affected base atoms, existing polling updates live integration state,
and failed sections expose retry. Do not add blanket refetching on navigation or
global keep-alive. Reuse retained results and in-flight reads through shared keys.

The installed `effect/unstable/reactivity/AtomRegistry` implementation separates
wrapper and base lifetimes. After a loader mount is released, an unused wrapper
without TTL is removed on the next scheduled tick. Removing it releases its base
dependency, but a base with idle TTL keeps its own retention window and in-flight
request until disposal. Immediate mount release therefore does not itself prove
request cancellation or duplicate fetching. This is source-verified behaviour,
not a new runtime measurement.

Release loader subscriptions when their work no longer owns them, including
aborted navigation. Useful speculative requests may finish within existing base
retention. Verify repeated hover, navigation, and expiry against the installed
registry behaviour; router preload retention and atom retention are independent.

## Session and organization changes

On sign-out or identity change, clear all user-specific cached data and prevent
old in-flight requests from repopulating the new session's state. Routing and
rendering must not expose the previous identity's cached results.

On organization switching within the same identity, retain correctly org-keyed
resource caches so switching back stays fast. Reset transient UI state tied to
the previous organization. Previous-org requests may only update their own keyed
resources, never the newly selected organization's UI. Cache retention does not
replace server authorization.

This establishes the lifecycle requirements for T-146. The concrete reset
mechanism remains subject to implementation review; this note does not choose a
new cache, registry abstraction, or API surface.

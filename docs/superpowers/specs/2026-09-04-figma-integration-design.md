# Figma Integration (T-51) — Design

Paste a Figma link into a ticket description and it becomes a compact chip
showing the file or frame name; expand it and it becomes a live Figma embed.
Behind that, ProjectProject resolves design metadata through the Figma REST
API, caches a thumbnail, and writes the ticket URL back onto the Figma node as
a Dev Mode resource so a designer inspecting the frame sees which ticket
implements it.

The behaviour deliberately matches the ticket-description attachments feature
(T-111/T-114): the markdown body is the sole source of truth, references are
reconciled into a derived index on save, and the editor node morphs between a
compact chip and a rich view.

## Scope

In scope for T-51:

- **A.** Editor node — Figma URL transformer, `FigmaNode`, chip ↔ live-embed
  morph, paste handling.
- **B.** Connections — Figma OAuth app, per-project credential with per-user
  override, two settings surfaces.
- **C.** Metadata & cache — `Figma` service, name resolution, thumbnail cache,
  `figma_link_index`, `figma_reference`, `reconcileTicket` extension.
- **D.** Dev Mode backlink — create and delete dev resources off C's
  reconciliation.

Explicitly out of scope, tracked separately:

- **Comment sync** (own ticket, stub created). Figma comments surfacing in the
  ticket thread. It is the only part needing webhook lifecycle management and
  Figma→ProjectProject identity mapping, and shares no code with A–D beyond
  reading `figma_reference`.
- **Freshness signals.** `FILE_UPDATE` webhooks marking a linked design as
  changed since last viewed. Deferred; revisit once links are in real use.
- **Design tokens / variables sync.** Figma gates `file_variables:read` behind
  Enterprise, so this is not available to us regardless of appetite.

## Dependency on T-114

This branch is cut from `feat/T-114-attachments-browser`, not `main`. T-114
introduces three services T-51 requires and `main` does not have:

- `SecretCrypto` — encryption for stored Figma credentials.
- `OrgStorage` / `S3Storage` — where cached thumbnails live.

T-51 also mirrors T-114's Lexical node construction directly. Once T-114
merges, this branch rebases onto `main`.

## What the Figma API actually offers

Verified against Figma's developer documentation, September 2026.

- **Auth.** OAuth2 with granular scopes, plus personal access tokens (created
  in Account Settings → Security, with configurable expiry and per-token
  scopes). Every scope this design needs is available on all plans:
  `file_content:read`, `file_metadata:read`, `file_dev_resources:read`,
  `file_dev_resources:write`. Enterprise-only scopes (`file_variables:*`,
  `library_analytics:read`, `org:*`) are not used.
- **Embeds.** Embed Kit 2.0 serves `embed.figma.com/design`, `/proto`,
  `/board`, `/slides`, `/deck` over iframe. Prototype embeds additionally
  require registering allowed embed origins against the OAuth app. Access is
  governed by the *viewer's own* Figma session.
- **Rendering.** `/v1/images` renders any node to PNG/SVG server-side; the file
  endpoint carries a thumbnail. This is the path to a preview that works for
  viewers with no Figma access.
- **Dev resources.** Up to 10 links may be attached to any node, surfacing in
  Dev Mode. Duplicate URLs on a node are rejected. Tier 2 rate limit.

## 1. Connections

`FigmaIntegrations` mirrors `EverhourIntegrations` one-for-one — that service
already establishes the exact dual-connection shape this ticket needs:

```ts
export interface FigmaIntegrationsShape {
  readonly getProfile: (userId: string) => Effect.Effect<PersonalFigma>
  readonly connectProfile: (...) => Effect.Effect<PersonalFigma, ...>
  readonly disconnectProfile: (userId: string) => Effect.Effect<PersonalFigma>
  readonly getProjectStatus: (...) => Effect.Effect<FigmaProjectIntegrationStatus, NotFound>
  readonly connectProject: (...) => Effect.Effect<..., FigmaIntegrationError>
  readonly disconnectProject: (...) => Effect.Effect<..., NotFound | Forbidden>
}
```

**One resolver seam carries the whole "both" decision.** A single
`credentialFor(orgSlug, slug, userId)` returns the personal credential when the
user has connected one, otherwise the project credential, otherwise fails
`FigmaNotConnected`. Every call site receives a resolved credential and never
learns which kind it got, so supporting both models costs one code path plus a
second settings surface — not two parallel implementations.

Credentials are encrypted at rest through `SecretCrypto`.

### The two seams use different credential types

- **Personal** — OAuth through our Figma app. Sent as `Authorization: Bearer`.
- **Project** — a scoped personal access token pasted into project settings.
  Sent as `X-Figma-Token`.

This is not a stylistic split. **Figma maintains only one access token per app
per user, and refreshing invalidates the previous one.** If a user connected
personally *and* the same account backed the project connection through the
same OAuth app, the second connection would silently invalidate the first,
surfacing as intermittent `FigmaAuthInvalid` from whichever seam refreshed
last. Different credential types cannot collide.

It also lets the project token be scoped to exactly the four scopes we need
with its own expiry, and matches Everhour's API-key project connection more
closely than dual OAuth would.

`credentialFor` therefore returns a tagged credential — `{ _tag: "Bearer" }` or
`{ _tag: "FigmaToken" }` — and the `Figma` service picks the header. That is
the only place in the codebase aware that two credential types exist.

### OAuth app configuration

Registered at `figma.com/developers/apps`, associated with the **team**, not a
personal account, so admins can reassign it.

- **Private app** — usable across the team without Figma review. Public
  submission (and its 512×512 logo and review cycle) is only needed if
  ProjectProject is ever offered to outside teams.
- **Redirect URLs** are allowlisted and token exchange is refused for any URL
  not registered, so production and localhost callbacks are both registered up
  front.
- **Embed origins** must be registered for prototype embeds to render.

Flow: `GET figma.com/oauth` → `POST api.figma.com/v1/oauth/token` →
`POST api.figma.com/v1/oauth/refresh`, with
`Authorization: Basic base64(client_id:client_secret)` on the two POSTs.
Authorization codes expire **30 seconds** after issue, and consent must happen
in a real browser rather than a WebView.

**Access tokens last 90 days.** Refresh-on-expiry is built in from the start —
a 90-day horizon means a missing refresh path looks healthy for a full quarter
before breaking.

**Storage is a precondition.** Project settings refuses a Figma connection
until org object storage is connected, with a prompt pointing at storage
settings. This keeps thumbnail behaviour uniform: every Figma link looks the
same in every project that has the integration at all, rather than silently
degrading per-project.

**Operational prerequisite:** a Figma OAuth application must be registered as
described above, with `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` provided to the
backend.

## 2. URL parsing

`parseFigmaUrl` lives in `packages/shared` beside `parseAttachmentUrl`, pure and
unit-tested:

```
figma.com/(design|board|slides|proto|file)/:fileKey/:slug?node-id=1-2
  → { kind, fileKey, nodeId, slug }
```

Both the frontend transformer and the backend reconciler call it, so "is this a
Figma link, and which node does it point at" has exactly one definition. A URL
that fails to parse is left as ordinary link text.

## 3. The editor node

`FigmaNode` is a `DecoratorNode` with `density: "compact" | "rich"`, and
`FIGMA_TRANSFORMER` is a `TextMatchTransformer` — the same construction as
`ATTACHMENT_TRANSFORMER`, matching a Figma URL rather than the
`/api/attachments/` prefix.

View state rides on the link as a query param, exactly as attachments encode
`width` and `density`:

```markdown
[Checkout flow — Step 2](https://figma.com/design/KEY/Checkout?node-id=1-2&pp-density=compact)
```

This is what keeps the feature markdown-first. Any other renderer — GitHub,
an AI agent reading the markdown tree, `cat` — sees an ordinary link to the
design. There is no new storage backing the body representation at all.

States:

- **compact** — Figma glyph plus resolved file/node name, inline.
- **rich** — `embed.figma.com/<kind>/<fileKey>?node-id=…` in an iframe,
  morphing through the same `LayoutGroup` the attachment node uses.
- **loading** — metadata not yet resolved; shows the URL slug as a placeholder
  name so the chip never collapses to nothing.
- **unresolvable** — the credential cannot see the file, or it was deleted.
  Reuses the `AttachmentUnavailable` presentation.

A `FigmaPlugin` mirrors `AttachmentsPlugin` for paste handling, so pasting a
Figma URL converts to a node immediately rather than on markdown round-trip.

Buttons in the node follow the press-feel and hover-feel rules; the expand and
remove controls reuse the attachment node's overlay treatment.

## 4. Metadata & thumbnails

A thin `Figma` service wraps the REST API — the role `GitHub` plays for Octokit
— with a tagged error taxonomy wired into `errorMessage.ts`:

`FigmaNotConnected`, `FigmaAuthInvalid`, `FigmaRateLimited`,
`FigmaFileNotFound`, `FigmaError`.

`figma_link_index` caches resolved metadata:

```
(fileKey, nodeId) → name, thumbnailKey, lastModified, fetchedAt
```

It is recoverable and never canonical — the same status `ticket_index` holds.
It can be dropped and rebuilt by re-resolving from `figma_reference`.
Thumbnails render through `/v1/images` and are written to `OrgStorage`.

Resolution happens on reconciliation rather than on render, so a ticket page
load never blocks on Figma and never fans out API calls per viewer.

## 5. Reconciliation & Dev Mode backlink

`reconcileTicket` is extended to parse Figma links alongside attachments,
writing `figma_reference` (org / project / ticket → fileKey / nodeId).

The reference delta drives everything downstream:

- **New reference** → resolve metadata, render and cache the thumbnail, and
  `POST` the ticket URL as a dev resource on the node.
- **Orphaned reference** → `DELETE` the dev resource.

This is why the backlink needs no bookkeeping of its own: the reconciliation
table that has to exist anyway is precisely the signal for when a backlink
should appear and disappear. Delete the prose, and the Dev Mode link retracts.

**Dev resource writes are best-effort.** A Figma outage, a rate limit, or a
revoked token must never fail a ticket save. Failures are logged and the
reference row is still written; a later reconciliation retries.

Two Figma constraints to respect: a node accepts at most 10 dev resources, and
rejects a duplicate URL on the same node. Both are treated as success — the
desired end state already holds.

## 6. Frontend state

`atoms/figma.ts` follows the project's mutation conventions: family-keyed by
the resource each mutation affects (`projectKey` for connection state,
`ticketKey` for link resolution), private base atom plus `Atom.optimistic`
wrapper, refreshing the base after a mutation lands. Connection toggles are
optimistic; metadata resolution is not, since there is nothing meaningful to
synthesise before the server answers.

Rendering uses `Result.matchWithError` with `ErrorPage contained` on the
settings surfaces.

## 7. i18n

New `figma_` prefix, in a new `packages/frontend/messages/en/figma.json`. Per
the project's own i18n rules, introducing a prefix requires updating the
AGENTS.md prefix table and the Inlang `pathPattern` **in the same PR**.

Design names inside Figma files are user-authored content and are never
translated — they pass through exactly as Figma reports them.

## 8. Testing

- **Pure units.** `parseFigmaUrl` against real Figma URL shapes: design, board,
  slides, proto, legacy `/file/`, with and without `node-id`, plus malformed
  input that must fall through to plain text.
- **Transformer round-trip.** Markdown → node → markdown preserves the URL and
  `pp-density`, mirroring the attachment transformer tests.
- **Reconciliation.** Adding and removing links produces the correct
  `figma_reference` delta; removing the last reference orphans the index row.
- **Backlink.** Dev resource created on new reference, deleted on orphan, and a
  Figma failure does not fail the save.
- **Credential resolution.** Personal credential preferred over project
  credential; neither present fails `FigmaNotConnected`; each tag produces the
  correct auth header.
- **Token refresh.** An expired OAuth token refreshes and retries once; a
  failed refresh surfaces `FigmaAuthInvalid` rather than a generic error.
- **Integration.** Figma API mocked at the HTTP boundary, as `GitHub.test.ts`
  and `EverhourWebhooks.test.ts` do.

## Build order

1. `parseFigmaUrl` + error taxonomy in `packages/shared`.
2. `Figma` service and `FigmaIntegrations`, with settings surfaces.
3. `figma_link_index` / `figma_reference` migrations and reconciliation.
4. `FigmaNode`, `FIGMA_TRANSFORMER`, `FigmaPlugin`.
5. Thumbnail caching.
6. Dev Mode backlink.

Steps 1–3 are backend and independently testable; the node in step 4 is the
first point where the feature is visible. The backlink lands last because it is
the only step that writes to a system outside our control.

## Open questions

None blocking. Two to settle during implementation:

- Exact endpoint shape for connection management on the shared `HttpApi`.
  Will follow the Everhour endpoints unless there is reason to diverge.
- Whether the compact chip shows the *file* name or the *node* name when a
  `node-id` is present. Leaning node name with the file name as hover title,
  since the node is what the link points at.

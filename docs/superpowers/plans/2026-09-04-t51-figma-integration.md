# Figma Integration (T-51) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a Figma link into a ticket description and it becomes a compact chip showing the frame name; expand it and it becomes a live Figma embed — with metadata and thumbnails resolved server-side and the ticket URL written back onto the Figma node as a Dev Mode resource.

**Architecture:** The markdown body is the sole source of truth for Figma links, exactly as it is for attachments. View state rides on the link as a query param, so other renderers see an ordinary link. On ticket save, `reconcileTicket` parses Figma links out of the body and writes a `figma_reference` delta; that delta drives metadata resolution, thumbnail caching, and Dev Mode backlink creation/deletion. Credentials resolve through a single `credentialFor` seam that returns either a personal OAuth bearer token or a project-level Figma PAT.

**Tech Stack:** Effect v3 (`Effect.gen`, Layers, `Schema.TaggedError`), Effect HttpApi, Drizzle + Postgres, Lexical (`DecoratorNode`, `TextMatchTransformer`), `@effect-atom/atom-react`, TanStack Start, shadcn/ui + Fluid Functionalism, paraglide i18n, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-figma-integration-design.md`

## Global Constraints

- **No comments.** Zero inline comments by default. No multi-line comment blocks, no design-rationale prose, no "this used to be X" notes. Rationale goes in the commit message.
- **All user-facing strings go through paraglide** (`m.*` from `@/paraglide/messages`). Raw literals in JSX are forbidden. New `figma_` prefix lives in `packages/frontend/messages/en/figma.json`; introducing the prefix requires updating the AGENTS.md prefix table **and** the Inlang `pathPattern` in the same PR.
- **User-authored content is never translated.** Figma design names pass through exactly as Figma reports them.
- **Press feel:** every clickable button gets `active:scale-[0.97]` with `transition-transform duration-100`.
- **Hover feel:** every hover-driven colour change is paired with `transition-colors` (or `transition-opacity`/`transition-all`).
- **Prefer component variants over local styling.** Extend the primitive rather than hand-rolling Tailwind at the callsite.
- **Every mutation atom is family-keyed** by the resource it affects — `projectKey(orgSlug, slug)` for project-scoped, `ticketKey(orgSlug, slug, id)` for ticket-scoped. Path fields come from the key, not the input.
- **Optimistic mutations** split into a private base atom plus an `Atom.optimistic` public wrapper; always refresh the *base* after the mutation lands, never the wrapper.
- **Render atom Results with `Result.matchWithError`**, handling all four variants. Failures use `ErrorPage`, with `contained` inside settings panels.
- **Tagged errors surface through `packages/frontend/src/lib/errorMessage.ts`.** Extend it for every new error that reaches the UI.
- **Dev resource writes are best-effort.** A Figma outage, rate limit, or revoked token must never fail a ticket save.
- **Scopes used:** `file_content:read`, `file_metadata:read`, `file_dev_resources:read`, `file_dev_resources:write`. No Enterprise-only scopes.
- **Branch:** `feat/T-51-figma-integration`, cut from `feat/T-114-attachments-browser`. Rebase onto `main` once T-114 merges.

## File Structure

**`packages/shared`** — the typed seam. Pure, dependency-free, unit-tested.

| File | Responsibility |
|---|---|
| `src/figma.ts` (create) | URL parsing, view params, ref extraction. Pure. |
| `src/figma.test.ts` (create) | Unit tests for the above. |
| `src/schemas/Figma.ts` (create) | `PersonalFigma`, `FigmaProjectIntegrationStatus`, `ConnectFigmaProjectInput`, `FigmaLinkMetadata`. |
| `src/errors.ts` (modify) | Five tagged Figma errors. |
| `src/api.ts` (modify) | `FigmaGroup` endpoint definitions. |
| `src/index.ts` (modify) | Re-exports. |

**`packages/backend`** — services split by responsibility, following the Everhour/GitHub split of `Services/` (interface + pure helpers) and `Layers/` (live implementation).

| File | Responsibility |
|---|---|
| `src/Services/Figma.ts` (create) | `Figma` tag: thin REST client interface + pure helpers. |
| `src/Layers/Figma.ts` (create) | Live REST client, credential headers, token refresh, error mapping. |
| `src/Services/FigmaIntegrations.ts` (create) | `FigmaIntegrations` tag: connect/disconnect/resolve. |
| `src/Layers/FigmaIntegrations.ts` (create) | Live implementation incl. `credentialFor`. |
| `src/Services/FigmaLinks.ts` (create) | `FigmaLinks` tag: reconciliation + metadata cache, incl. pure `planFigmaReferences`. |
| `src/Layers/FigmaLinks.ts` (create) | Live reconciliation, thumbnail caching, dev-resource sync. |
| `src/handlers/figma.ts` (create) | HttpApi handlers. |
| `src/http/figmaOauthRoutes.ts` (create) | OAuth start + callback (outside HttpApi — it redirects). |
| `src/db/schema.ts` (modify) | Four new tables; extend two provider enums. |
| `src/Layers/Tickets.ts` (modify) | Call `figmaLinks.reconcileTicket` beside `attachments.reconcileTicket`. |

**`packages/frontend`**

| File | Responsibility |
|---|---|
| `src/atoms/figma.ts` (create) | Connection + link-metadata atoms. |
| `src/components/Lexical/FigmaNode.tsx` (create) | `DecoratorNode`, chip ↔ embed morph. |
| `src/components/Lexical/FigmaChip.tsx` (create) | Compact presentation. |
| `src/components/Lexical/FigmaEmbed.tsx` (create) | Expanded iframe presentation. |
| `src/components/Lexical/figmaTransformer.ts` (create) | `FIGMA_TRANSFORMER`. |
| `src/components/Lexical/FigmaExtension.ts` (create) | Node registration. |
| `src/components/Lexical/FigmaPlugin.tsx` (create) | Paste handling. |
| `src/components/LexicalEditor.tsx` (modify) | Register extension + transformer. |
| `src/components/settings/FigmaProjectSettings.tsx` (create) | Project connection panel. |
| `src/components/settings/FigmaProfileSettings.tsx` (create) | Profile connection panel. |
| `messages/en/figma.json` (create) | `figma_` strings. |
| `src/lib/errorMessage.ts` (modify) | Map the five Figma errors. |

**Root:** `AGENTS.md` (i18n table), `.env.example`, `.env.production.example`, `project.inlang/settings.json` (pathPattern).

---

## Task 1: Figma URL parsing in `packages/shared`

Pure functions with no dependencies. Both the frontend transformer and the backend reconciler consume these, so "is this a Figma link" has exactly one definition.

**Files:**
- Create: `packages/shared/src/figma.ts`
- Test: `packages/shared/src/figma.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `FigmaKind`, `FigmaRef { kind, fileKey, nodeId, slug }`, `parseFigmaUrl(url: string): FigmaRef | null`, `FigmaDensity = "rich" | "compact"`, `figmaViewParams(url: string): { density: FigmaDensity }`, `withFigmaParams(url: string, params: { density?: FigmaDensity }): string`, `figmaEmbedUrl(ref: FigmaRef, url: string): string`, `extractFigmaRefs(markdown: string): ReadonlyArray<FigmaRef>`, `figmaRefKey(ref: FigmaRef): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/figma.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  extractFigmaRefs,
  figmaEmbedUrl,
  figmaRefKey,
  figmaViewParams,
  parseFigmaUrl,
  withFigmaParams
} from "./figma"

const KEY = "aBcDeF1234567890GhIjKl"

describe("parseFigmaUrl", () => {
  it("parses a design url with a node id", () => {
    expect(
      parseFigmaUrl(`https://www.figma.com/design/${KEY}/Checkout?node-id=12-345`)
    ).toEqual({
      kind: "design",
      fileKey: KEY,
      nodeId: "12:345",
      slug: "Checkout"
    })
  })

  it("normalises a node id that already uses a colon", () => {
    expect(
      parseFigmaUrl(`https://figma.com/design/${KEY}/Checkout?node-id=12%3A345`)
        ?.nodeId
    ).toBe("12:345")
  })

  it("returns a null node id when none is present", () => {
    expect(parseFigmaUrl(`https://figma.com/design/${KEY}/Checkout`)?.nodeId).toBeNull()
  })

  it("parses board, slides, proto and legacy file urls", () => {
    const kinds = [
      ["board", "board"],
      ["slides", "slides"],
      ["proto", "proto"],
      ["file", "design"]
    ] as const
    for (const [segment, kind] of kinds) {
      expect(parseFigmaUrl(`https://figma.com/${segment}/${KEY}/Name`)?.kind).toBe(kind)
    }
  })

  it("decodes a percent-encoded slug", () => {
    expect(parseFigmaUrl(`https://figma.com/design/${KEY}/Design%20System`)?.slug).toBe(
      "Design System"
    )
  })

  it("tolerates a missing slug", () => {
    expect(parseFigmaUrl(`https://figma.com/design/${KEY}`)).toEqual({
      kind: "design",
      fileKey: KEY,
      nodeId: null,
      slug: ""
    })
  })

  it("rejects a non-figma host", () => {
    expect(parseFigmaUrl(`https://notfigma.test/design/${KEY}/Checkout`)).toBeNull()
  })

  it("rejects a lookalike host", () => {
    expect(parseFigmaUrl(`https://figma.com.evil.test/design/${KEY}/Checkout`)).toBeNull()
  })

  it("rejects an unknown path segment", () => {
    expect(parseFigmaUrl(`https://figma.com/community/${KEY}/Checkout`)).toBeNull()
  })

  it("rejects a url with no file key", () => {
    expect(parseFigmaUrl("https://figma.com/design/")).toBeNull()
  })

  it("rejects unparseable input", () => {
    expect(parseFigmaUrl("not a url")).toBeNull()
  })
})

describe("figmaViewParams", () => {
  it("defaults to rich", () => {
    expect(figmaViewParams(`https://figma.com/design/${KEY}/N`).density).toBe("rich")
  })

  it("reads compact from pp-density", () => {
    expect(
      figmaViewParams(`https://figma.com/design/${KEY}/N?pp-density=compact`).density
    ).toBe("compact")
  })
})

describe("withFigmaParams", () => {
  it("adds pp-density without dropping figma's own params", () => {
    const out = withFigmaParams(
      `https://figma.com/design/${KEY}/N?node-id=1-2`,
      { density: "compact" }
    )
    expect(out).toContain("node-id=1-2")
    expect(out).toContain("pp-density=compact")
  })

  it("omits pp-density when rich", () => {
    const out = withFigmaParams(`https://figma.com/design/${KEY}/N`, {
      density: "rich"
    })
    expect(out).not.toContain("pp-density")
  })

  it("replaces an existing pp-density rather than appending", () => {
    const out = withFigmaParams(
      `https://figma.com/design/${KEY}/N?pp-density=compact`,
      { density: "rich" }
    )
    expect(out).not.toContain("pp-density")
  })

  it("round-trips through figmaViewParams", () => {
    const out = withFigmaParams(`https://figma.com/design/${KEY}/N`, {
      density: "compact"
    })
    expect(figmaViewParams(out).density).toBe("compact")
  })
})

describe("figmaEmbedUrl", () => {
  it("builds an embed url carrying the node id", () => {
    const url = `https://figma.com/design/${KEY}/N?node-id=1-2`
    const ref = parseFigmaUrl(url)!
    const embed = figmaEmbedUrl(ref, url)
    expect(embed.startsWith(`https://embed.figma.com/design/${KEY}/`)).toBe(true)
    expect(embed).toContain("node-id=1%3A2")
    expect(embed).toContain("embed-host=projectproject")
  })

  it("omits node-id when the ref has none", () => {
    const url = `https://figma.com/board/${KEY}/N`
    expect(figmaEmbedUrl(parseFigmaUrl(url)!, url)).not.toContain("node-id")
  })
})

describe("extractFigmaRefs", () => {
  it("finds refs inside markdown links", () => {
    const md = `See [Checkout](https://figma.com/design/${KEY}/Checkout?node-id=1-2) today.`
    expect(extractFigmaRefs(md)).toEqual([
      { kind: "design", fileKey: KEY, nodeId: "1:2", slug: "Checkout" }
    ])
  })

  it("dedupes the same file and node", () => {
    const md = `a https://figma.com/design/${KEY}/A?node-id=1-2 b https://figma.com/design/${KEY}/A?node-id=1-2`
    expect(extractFigmaRefs(md)).toHaveLength(1)
  })

  it("keeps distinct nodes in the same file apart", () => {
    const md = `https://figma.com/design/${KEY}/A?node-id=1-2 https://figma.com/design/${KEY}/A?node-id=3-4`
    expect(extractFigmaRefs(md)).toHaveLength(2)
  })

  it("returns nothing for markdown with no figma links", () => {
    expect(extractFigmaRefs("# Title\n\nSome text.")).toEqual([])
  })
})

describe("figmaRefKey", () => {
  it("distinguishes a file-level ref from a node-level one", () => {
    const file = parseFigmaUrl(`https://figma.com/design/${KEY}/A`)!
    const node = parseFigmaUrl(`https://figma.com/design/${KEY}/A?node-id=1-2`)!
    expect(figmaRefKey(file)).not.toBe(figmaRefKey(node))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/shared vitest run src/figma.test.ts`
Expected: FAIL — `Failed to resolve import "./figma"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/figma.ts`:

```ts
export type FigmaKind = "design" | "board" | "slides" | "proto"

export type FigmaDensity = "rich" | "compact"

export interface FigmaRef {
  readonly kind: FigmaKind
  readonly fileKey: string
  readonly nodeId: string | null
  readonly slug: string
}

const DENSITY_PARAM = "pp-density"

const FILE_KEY_PATTERN = /^[A-Za-z0-9]{10,64}$/

const SEGMENT_KINDS: Record<string, FigmaKind> = {
  design: "design",
  board: "board",
  slides: "slides",
  proto: "proto",
  file: "design"
}

const isFigmaHost = (host: string): boolean =>
  host === "figma.com" || host === "www.figma.com"

const toUrl = (url: string): URL | null => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

const normaliseNodeId = (raw: string | null): string | null => {
  if (raw === null) return null
  const value = raw.replace(/-/g, ":").trim()
  return value.length === 0 ? null : value
}

export const parseFigmaUrl = (url: string): FigmaRef | null => {
  const parsed = toUrl(url)
  if (parsed === null) return null
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
  if (!isFigmaHost(parsed.hostname)) return null

  const segments = parsed.pathname.split("/").filter((part) => part.length > 0)
  const [segment, fileKey, slug] = segments
  if (segment === undefined || fileKey === undefined) return null

  const kind = SEGMENT_KINDS[segment]
  if (kind === undefined) return null
  if (!FILE_KEY_PATTERN.test(fileKey)) return null

  return {
    kind,
    fileKey,
    nodeId: normaliseNodeId(parsed.searchParams.get("node-id")),
    slug: slug === undefined ? "" : decodeURIComponent(slug)
  }
}

export const figmaViewParams = (url: string): { density: FigmaDensity } => {
  const parsed = toUrl(url)
  const density = parsed?.searchParams.get(DENSITY_PARAM)
  return { density: density === "compact" ? "compact" : "rich" }
}

export const withFigmaParams = (
  url: string,
  params: { readonly density?: FigmaDensity }
): string => {
  const parsed = toUrl(url)
  if (parsed === null) return url
  if (params.density === "compact") {
    parsed.searchParams.set(DENSITY_PARAM, "compact")
  } else {
    parsed.searchParams.delete(DENSITY_PARAM)
  }
  return parsed.toString()
}

export const figmaSrc = (url: string): string => {
  const parsed = toUrl(url)
  if (parsed === null) return url
  parsed.searchParams.delete(DENSITY_PARAM)
  return parsed.toString()
}

export const figmaEmbedUrl = (ref: FigmaRef, url: string): string => {
  const embed = new URL(
    `https://embed.figma.com/${ref.kind}/${ref.fileKey}/${encodeURIComponent(
      ref.slug.length === 0 ? "file" : ref.slug
    )}`
  )
  embed.searchParams.set("embed-host", "projectproject")
  if (ref.nodeId !== null) embed.searchParams.set("node-id", ref.nodeId)
  const source = toUrl(url)
  const mode = source?.searchParams.get("mode")
  if (mode !== null && mode !== undefined) embed.searchParams.set("mode", mode)
  return embed.toString()
}

export const figmaRefKey = (ref: FigmaRef): string =>
  `${ref.fileKey}/${ref.nodeId ?? ""}`

const FIGMA_URL_CANDIDATE_RE =
  /https?:\/\/(?:www\.)?figma\.com\/(?:design|board|slides|proto|file)\/[^\s)<>"']+/g

export const extractFigmaRefs = (
  markdown: string
): ReadonlyArray<FigmaRef> => {
  const seen = new Set<string>()
  const out: Array<FigmaRef> = []
  for (const match of markdown.matchAll(FIGMA_URL_CANDIDATE_RE)) {
    const ref = parseFigmaUrl(match[0])
    if (ref === null) continue
    const key = figmaRefKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/shared vitest run src/figma.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Export from the package index**

Add to `packages/shared/src/index.ts`, following the existing export style in that file:

```ts
export * from "./figma"
```

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add packages/shared/src/figma.ts packages/shared/src/figma.test.ts packages/shared/src/index.ts
git commit -m "feat(figma): parse figma urls in shared"
```

---

## Task 2: Errors, schemas, and i18n scaffolding

Everything the later tasks reference by name. Doing it up front means no task blocks on an undefined error tag.

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/schemas/Figma.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/frontend/messages/en/figma.json`
- Modify: `packages/frontend/src/lib/errorMessage.ts`
- Modify: `AGENTS.md`, `project.inlang/settings.json`

**Interfaces:**
- Consumes: Task 1's `FigmaDensity`.
- Produces: `FigmaNotConnected`, `FigmaAuthInvalid`, `FigmaRateLimited`, `FigmaFileNotFound`, `FigmaError`; `PersonalFigma`, `FigmaProjectIntegrationStatus`, `ConnectFigmaProjectInput`, `FigmaLinkMetadata`.

- [ ] **Step 1: Add the tagged errors**

Append to `packages/shared/src/errors.ts`, matching the `Schema.TaggedError` style already used by `EverhourAuthInvalid`:

```ts
export class FigmaNotConnected extends Schema.TaggedError<FigmaNotConnected>()(
  "FigmaNotConnected",
  {},
  HttpApiSchema.annotations({ status: 409 })
) {}

export class FigmaAuthInvalid extends Schema.TaggedError<FigmaAuthInvalid>()(
  "FigmaAuthInvalid",
  {},
  HttpApiSchema.annotations({ status: 401 })
) {}

export class FigmaRateLimited extends Schema.TaggedError<FigmaRateLimited>()(
  "FigmaRateLimited",
  { retryAfterSeconds: Schema.Number },
  HttpApiSchema.annotations({ status: 429 })
) {}

export class FigmaFileNotFound extends Schema.TaggedError<FigmaFileNotFound>()(
  "FigmaFileNotFound",
  { fileKey: Schema.String },
  HttpApiSchema.annotations({ status: 404 })
) {}

export class FigmaError extends Schema.TaggedError<FigmaError>()(
  "FigmaError",
  { reason: Schema.String },
  HttpApiSchema.annotations({ status: 502 })
) {}
```

- [ ] **Step 2: Add the schemas**

Create `packages/shared/src/schemas/Figma.ts`:

```ts
import * as Schema from "effect/Schema"

export const PersonalFigma = Schema.Struct({
  connected: Schema.Boolean,
  figmaUserId: Schema.NullOr(Schema.String),
  handle: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  lastVerifiedAt: Schema.NullOr(Schema.DateTimeUtc),
  lastCheckError: Schema.NullOr(Schema.String)
})
export type PersonalFigma = Schema.Schema.Type<typeof PersonalFigma>

export const FigmaProjectIntegrationStatus = Schema.Struct({
  connected: Schema.Boolean,
  handle: Schema.NullOr(Schema.String),
  connectedAt: Schema.NullOr(Schema.DateTimeUtc),
  lastCheckStatus: Schema.NullOr(Schema.Literal("ok", "error")),
  lastCheckError: Schema.NullOr(Schema.String),
  storageConnected: Schema.Boolean
})
export type FigmaProjectIntegrationStatus = Schema.Schema.Type<
  typeof FigmaProjectIntegrationStatus
>

export const ConnectFigmaProjectInput = Schema.Struct({
  accessToken: Schema.String.pipe(Schema.minLength(1))
})
export type ConnectFigmaProjectInput = Schema.Schema.Type<
  typeof ConnectFigmaProjectInput
>

export const FigmaLinkMetadata = Schema.Struct({
  fileKey: Schema.String,
  nodeId: Schema.NullOr(Schema.String),
  name: Schema.String,
  fileName: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  lastModified: Schema.NullOr(Schema.DateTimeUtc)
})
export type FigmaLinkMetadata = Schema.Schema.Type<typeof FigmaLinkMetadata>
```

- [ ] **Step 3: Export both from the package index**

Add to `packages/shared/src/index.ts`:

```ts
export * from "./schemas/Figma"
```

(`errors.ts` is already re-exported; verify with `grep -n 'errors' packages/shared/src/index.ts` and add the export only if absent.)

- [ ] **Step 4: Add the message file**

Create `packages/frontend/messages/en/figma.json`, keys sorted alphabetically:

```json
{
  "$schema": "https://inlang.com/schema/inlang-message-format",
  "figma_chip_loading": "Loading design…",
  "figma_chip_unavailable": "Design unavailable",
  "figma_embed_collapse": "Collapse",
  "figma_embed_expand": "Expand",
  "figma_embed_open_in_figma": "Open in Figma",
  "figma_embed_remove": "Remove",
  "figma_error_auth_invalid": "Figma rejected the stored credentials. Reconnect Figma to continue.",
  "figma_error_file_not_found": "That Figma file no longer exists, or this connection cannot see it.",
  "figma_error_generic": "Figma could not be reached. Try again in a moment.",
  "figma_error_not_connected": "Figma is not connected for this project.",
  "figma_error_rate_limited": "Figma is rate limiting us. Try again shortly.",
  "figma_profile_connect_button": "Connect Figma",
  "figma_profile_connected_status": "Connected as {handle}",
  "figma_profile_description": "Connect your own Figma account so designs resolve with your permissions.",
  "figma_profile_disconnect_button": "Disconnect",
  "figma_profile_disconnected_status": "Not connected",
  "figma_profile_title": "Figma",
  "figma_project_connect_button": "Connect",
  "figma_project_description": "A scoped Figma personal access token used to resolve designs for everyone on this project.",
  "figma_project_disconnect_button": "Disconnect",
  "figma_project_storage_required": "Connect object storage before connecting Figma.",
  "figma_project_title": "Figma",
  "figma_project_token_label": "Personal access token"
}
```

- [ ] **Step 5: Register the message file with Inlang**

Add `./messages/en/figma.json` to the `pathPattern` array in `project.inlang/settings.json`, matching how the existing per-domain files are listed. Verify the exact key name first:

Run: `grep -n "pathPattern" -A 15 project.inlang/settings.json`

- [ ] **Step 6: Update the AGENTS.md i18n table**

Add a row to the prefix table in `AGENTS.md`:

```
| `packages/frontend/messages/en/figma.json`    | `figma_`                                               |
```

- [ ] **Step 7: Map the errors in the UI error layer**

Add cases to `packages/frontend/src/lib/errorMessage.ts` in the same shape as the existing Everhour cases (read the file first to match its switch/lookup form exactly):

```ts
case "FigmaNotConnected":
  return m.figma_error_not_connected()
case "FigmaAuthInvalid":
  return m.figma_error_auth_invalid()
case "FigmaRateLimited":
  return m.figma_error_rate_limited()
case "FigmaFileNotFound":
  return m.figma_error_file_not_found()
case "FigmaError":
  return m.figma_error_generic()
```

- [ ] **Step 8: Regenerate paraglide, typecheck, commit**

```bash
bun run --cwd packages/frontend build:messages
bun run typecheck
git add packages/shared/src/errors.ts packages/shared/src/schemas/Figma.ts \
  packages/shared/src/index.ts packages/frontend/messages/en/figma.json \
  packages/frontend/src/lib/errorMessage.ts AGENTS.md project.inlang/settings.json
git commit -m "feat(figma): add error taxonomy, schemas and messages"
```

If `build:messages` is not the script name, run `grep -n '"scripts"' -A 20 packages/frontend/package.json` and use the paraglide compile script listed there.

---

## Task 3: Database schema

Four tables. Credential columns follow `userEverhourIntegration`'s three-column sealed-secret shape (`ciphertext`, `nonce`, `tag`) so `SecretCrypto.seal`/`open` map directly.

**Files:**
- Modify: `packages/backend/src/db/schema.ts`
- Create: migration under `packages/backend/src/db/migrations/`

**Interfaces:**
- Consumes: nothing.
- Produces: `userFigmaIntegration`, `projectFigmaIntegration`, `figmaLinkIndex`, `figmaReference` Drizzle tables.

- [ ] **Step 1: Extend the provider enums**

In `packages/backend/src/db/schema.ts`, add `"figma"` to both provider enums:

- `organizationIntegration.provider` — `{ enum: ["github", "everhour", "s3", "figma"] }`
- `projectIntegrationLink.provider` — `{ enum: ["github", "everhour", "figma"] }`

These are Drizzle TS-level enums on `text` columns, not Postgres enum types, so no data migration is needed for this step.

- [ ] **Step 2: Add the four tables**

Append to `packages/backend/src/db/schema.ts`:

```ts
export const userFigmaIntegration = pgTable("user_figma_integration", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  accessTokenNonce: text("access_token_nonce").notNull(),
  accessTokenTag: text("access_token_tag").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  refreshTokenNonce: text("refresh_token_nonce").notNull(),
  refreshTokenTag: text("refresh_token_tag").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  figmaUserId: text("figma_user_id").notNull(),
  handle: text("handle"),
  email: text("email"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
  lastCheckError: text("last_check_error")
})

export const projectFigmaIntegration = pgTable(
  "project_figma_integration",
  {
    projectIntegrationLinkId: uuid("project_integration_link_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["active", "disconnected", "broken"]
    }).notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    accessTokenNonce: text("access_token_nonce").notNull(),
    accessTokenTag: text("access_token_tag").notNull(),
    handle: text("handle"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckError: text("last_check_error")
  },
  (t) => [
    foreignKey({
      name: "project_figma_integration_link_id_organization_id_fkey",
      columns: [t.projectIntegrationLinkId, t.organizationId],
      foreignColumns: [
        projectIntegrationLink.id,
        projectIntegrationLink.organizationId
      ]
    }).onDelete("cascade")
  ]
)

export const figmaLinkIndex = pgTable(
  "figma_link_index",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    fileKey: text("file_key").notNull(),
    nodeId: text("node_id"),
    kind: text("kind", {
      enum: ["design", "board", "slides", "proto"]
    }).notNull(),
    name: text("name"),
    fileName: text("file_name"),
    thumbnailKey: text("thumbnail_key"),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckError: text("last_check_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    uniqueIndex("figma_link_index_node_uidx").on(
      t.orgSlug,
      t.fileKey,
      t.nodeId
    ),
    index("figma_link_index_org_idx").on(t.organizationId),
    index("figma_link_index_file_idx").on(t.orgSlug, t.fileKey)
  ]
)

export const figmaReference = pgTable(
  "figma_reference",
  {
    linkId: text("link_id")
      .notNull()
      .references(() => figmaLinkIndex.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    projectSlug: text("project_slug").notNull(),
    ticketId: text("ticket_id").notNull(),
    devResourceId: text("dev_resource_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.projectSlug, t.ticketId] }),
    index("figma_reference_ticket_idx").on(
      t.orgSlug,
      t.projectSlug,
      t.ticketId
    )
  ]
)
```

`nodeId` is nullable and participates in a unique index. Postgres treats `NULL`s as distinct in a plain unique index, which would allow duplicate file-level rows — so the reconciler in Task 7 always looks a row up by `(orgSlug, fileKey, nodeId)` with an explicit `IS NULL` comparison, and inserts through `onConflictDoUpdate` keyed on the same triple. Confirm the generated migration emits `NULLS NOT DISTINCT` on `figma_link_index_node_uidx`; if the Drizzle version in use does not support it, add it by hand to the migration SQL.

- [ ] **Step 3: Generate the migration**

Run: `bun run --cwd packages/backend db:generate`

Check the script name first with `grep -n '"scripts"' -A 15 packages/backend/package.json` if that fails.

- [ ] **Step 4: Inspect the generated SQL**

Read the new file under `packages/backend/src/db/migrations/`. Confirm it creates four tables and no destructive statements (`DROP`, `ALTER ... TYPE`) against existing tables. If it contains any, stop and report rather than applying.

- [ ] **Step 5: Apply and verify**

```bash
bun run --cwd packages/backend db:migrate
```

Expected: migration applies cleanly.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/db/schema.ts packages/backend/src/db/migrations
git commit -m "feat(figma): add figma integration and link tables"
```

---

## Task 4: The `Figma` REST client

A thin client with a tagged credential. This is the only place in the codebase that knows two credential types exist.

**Files:**
- Create: `packages/backend/src/Services/Figma.ts`
- Create: `packages/backend/src/Layers/Figma.ts`
- Test: `packages/backend/src/Layers/Figma.test.ts`

**Interfaces:**
- Consumes: Task 1's `FigmaRef`; Task 2's error classes.
- Produces: `FigmaCredential`, `figmaAuthHeader`, `Figma` tag with `getFile`, `getNodeName`, `renderNode`, `createDevResource`, `deleteDevResource`, `getMe`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/Layers/Figma.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { figmaAuthHeader, figmaImageScale } from "../Services/Figma"

describe("figmaAuthHeader", () => {
  it("uses a bearer header for an oauth credential", () => {
    expect(figmaAuthHeader({ _tag: "Bearer", token: "abc" })).toEqual({
      Authorization: "Bearer abc"
    })
  })

  it("uses the figma token header for a personal access token", () => {
    expect(figmaAuthHeader({ _tag: "FigmaToken", token: "abc" })).toEqual({
      "X-Figma-Token": "abc"
    })
  })
})

describe("figmaImageScale", () => {
  it("clamps below the minimum", () => {
    expect(figmaImageScale(0)).toBe(0.01)
  })

  it("clamps above the maximum", () => {
    expect(figmaImageScale(99)).toBe(4)
  })

  it("passes a valid scale through", () => {
    expect(figmaImageScale(2)).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/backend vitest run src/Layers/Figma.test.ts`
Expected: FAIL — cannot resolve `../Services/Figma`.

- [ ] **Step 3: Write the service interface and pure helpers**

Create `packages/backend/src/Services/Figma.ts`:

```ts
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  FigmaAuthInvalid,
  FigmaError,
  FigmaFileNotFound,
  FigmaRateLimited
} from "@projectproject/shared"

export type FigmaCredential =
  | { readonly _tag: "Bearer"; readonly token: string }
  | { readonly _tag: "FigmaToken"; readonly token: string }

export type FigmaCallError =
  | FigmaAuthInvalid
  | FigmaRateLimited
  | FigmaFileNotFound
  | FigmaError

export const figmaAuthHeader = (
  credential: FigmaCredential
): Record<string, string> =>
  credential._tag === "Bearer"
    ? { Authorization: `Bearer ${credential.token}` }
    : { "X-Figma-Token": credential.token }

export const figmaImageScale = (scale: number): number =>
  Math.min(4, Math.max(0.01, Number.isFinite(scale) ? scale : 1))

export interface FigmaFileSummary {
  readonly name: string
  readonly lastModified: Date | null
  readonly thumbnailUrl: string | null
}

export interface FigmaNodeSummary {
  readonly name: string
}

export interface FigmaIdentity {
  readonly id: string
  readonly handle: string | null
  readonly email: string | null
}

export interface FigmaShape {
  readonly getMe: (
    credential: FigmaCredential
  ) => Effect.Effect<FigmaIdentity, FigmaCallError>
  readonly getFile: (
    credential: FigmaCredential,
    fileKey: string
  ) => Effect.Effect<FigmaFileSummary, FigmaCallError>
  readonly getNodeName: (
    credential: FigmaCredential,
    fileKey: string,
    nodeId: string
  ) => Effect.Effect<FigmaNodeSummary, FigmaCallError>
  readonly renderNode: (
    credential: FigmaCredential,
    fileKey: string,
    nodeId: string | null,
    scale: number
  ) => Effect.Effect<Uint8Array, FigmaCallError>
  readonly createDevResource: (
    credential: FigmaCredential,
    input: {
      readonly fileKey: string
      readonly nodeId: string
      readonly name: string
      readonly url: string
    }
  ) => Effect.Effect<string | null, FigmaCallError>
  readonly deleteDevResource: (
    credential: FigmaCredential,
    fileKey: string,
    devResourceId: string
  ) => Effect.Effect<void, FigmaCallError>
}

export class Figma extends Context.Tag("Figma")<Figma, FigmaShape>() {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/backend vitest run src/Layers/Figma.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the live layer**

Create `packages/backend/src/Layers/Figma.ts` implementing `FigmaShape` against `https://api.figma.com`. Mirror the HTTP-client style already used in `packages/backend/src/Layers/Everhour.ts` — read that file first and follow its request helper, JSON decoding and error-mapping structure rather than introducing a new one.

Required behaviour:

- Status mapping: `401`/`403` → `FigmaAuthInvalid`; `404` → `FigmaFileNotFound({ fileKey })`; `429` → `FigmaRateLimited({ retryAfterSeconds })` reading the `Retry-After` header and defaulting to `60` when absent or unparseable; anything else non-2xx → `FigmaError({ reason })`.
- `getMe` → `GET /v1/me`, mapping `id`, `handle`, `email`.
- `getFile` → `GET /v1/files/:fileKey?depth=1`, mapping `name`, `lastModified`, `thumbnailUrl`.
- `getNodeName` → `GET /v1/files/:fileKey/nodes?ids=:nodeId`, reading `nodes[nodeId].document.name`; when the node is absent, fail `FigmaFileNotFound({ fileKey })`.
- `renderNode` → `GET /v1/images/:fileKey?ids=:nodeId&format=png&scale=…` (using `figmaImageScale`), then fetch the returned signed URL and return its bytes. When `nodeId` is `null`, fall back to `getFile`'s `thumbnailUrl`. A null entry in the `images` map means the node cannot be rendered — fail `FigmaError({ reason: "node_not_renderable" })`.
- `createDevResource` → `POST /v1/dev_resources` with `{ dev_resources: [{ name, url, file_key, node_id }] }`. Figma rejects a duplicate URL on a node and caps a node at 10 dev resources; treat **both** as success and return `null`, since the desired end state already holds.
- `deleteDevResource` → `DELETE /v1/files/:fileKey/dev_resources/:devResourceId`. A `404` is success — the resource is already gone.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
bun run --cwd packages/backend vitest run src/Layers/Figma.test.ts
git add packages/backend/src/Services/Figma.ts packages/backend/src/Layers/Figma.ts \
  packages/backend/src/Layers/Figma.test.ts
git commit -m "feat(figma): add figma rest client"
```

---

## Task 5: `FigmaIntegrations` and the `credentialFor` seam

The whole "personal OAuth with project PAT fallback" decision lives in one function.

**Files:**
- Create: `packages/backend/src/Services/FigmaIntegrations.ts`
- Create: `packages/backend/src/Layers/FigmaIntegrations.ts`
- Test: `packages/backend/src/Layers/FigmaIntegrations.test.ts`

**Interfaces:**
- Consumes: Task 3's tables; Task 4's `Figma`, `FigmaCredential`; `SecretCrypto` from `../Services/SecretCrypto`; `OrgStorage`.
- Produces: `FigmaIntegrations` tag with `getProfile`, `beginProfileConnect`, `completeProfileConnect`, `disconnectProfile`, `getProjectStatus`, `connectProject`, `disconnectProject`, `credentialFor`; pure helper `chooseCredential`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/Layers/FigmaIntegrations.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { chooseCredential, isTokenExpired } from "../Services/FigmaIntegrations"

describe("chooseCredential", () => {
  it("prefers the personal oauth token", () => {
    expect(
      chooseCredential({ personalToken: "personal", projectToken: "project" })
    ).toEqual({ _tag: "Bearer", token: "personal" })
  })

  it("falls back to the project token", () => {
    expect(
      chooseCredential({ personalToken: null, projectToken: "project" })
    ).toEqual({ _tag: "FigmaToken", token: "project" })
  })

  it("returns null when neither is present", () => {
    expect(
      chooseCredential({ personalToken: null, projectToken: null })
    ).toBeNull()
  })
})

describe("isTokenExpired", () => {
  const now = new Date("2026-09-04T12:00:00Z")

  it("treats a token expiring inside the skew window as expired", () => {
    expect(isTokenExpired(new Date("2026-09-04T12:04:00Z"), now)).toBe(true)
  })

  it("treats a token well in the future as valid", () => {
    expect(isTokenExpired(new Date("2026-10-04T12:00:00Z"), now)).toBe(false)
  })

  it("treats an already-past expiry as expired", () => {
    expect(isTokenExpired(new Date("2026-09-03T12:00:00Z"), now)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/backend vitest run src/Layers/FigmaIntegrations.test.ts`
Expected: FAIL — cannot resolve `../Services/FigmaIntegrations`.

- [ ] **Step 3: Write the service interface and pure helpers**

Create `packages/backend/src/Services/FigmaIntegrations.ts`:

```ts
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected,
  FigmaProjectIntegrationStatus,
  FigmaRateLimited,
  Forbidden,
  NotFound,
  PersonalFigma,
  StorageNotConnected
} from "@projectproject/shared"
import type { FigmaCredential } from "./Figma"

export const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000

export const isTokenExpired = (expiresAt: Date, now: Date): boolean =>
  expiresAt.getTime() - now.getTime() <= TOKEN_EXPIRY_SKEW_MS

export const chooseCredential = (input: {
  readonly personalToken: string | null
  readonly projectToken: string | null
}): FigmaCredential | null => {
  if (input.personalToken !== null) {
    return { _tag: "Bearer", token: input.personalToken }
  }
  if (input.projectToken !== null) {
    return { _tag: "FigmaToken", token: input.projectToken }
  }
  return null
}

export type FigmaIntegrationError =
  | NotFound
  | Forbidden
  | FigmaNotConnected
  | FigmaAuthInvalid
  | FigmaRateLimited
  | FigmaError

export interface FigmaIntegrationsShape {
  readonly getProfile: (userId: string) => Effect.Effect<PersonalFigma>
  readonly beginProfileConnect: (
    userId: string
  ) => Effect.Effect<{ readonly authorizeUrl: string; readonly state: string }>
  readonly completeProfileConnect: (
    userId: string,
    code: string,
    state: string
  ) => Effect.Effect<PersonalFigma, FigmaAuthInvalid | FigmaError>
  readonly disconnectProfile: (userId: string) => Effect.Effect<PersonalFigma>
  readonly getProjectStatus: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<FigmaProjectIntegrationStatus, NotFound>
  readonly connectProject: (
    orgSlug: string,
    userId: string,
    slug: string,
    accessToken: string
  ) => Effect.Effect<
    FigmaProjectIntegrationStatus,
    FigmaIntegrationError | StorageNotConnected
  >
  readonly disconnectProject: (
    orgSlug: string,
    userId: string,
    slug: string
  ) => Effect.Effect<FigmaProjectIntegrationStatus, NotFound | Forbidden>
  readonly credentialFor: (
    orgSlug: string,
    slug: string,
    userId: string | null
  ) => Effect.Effect<FigmaCredential, FigmaNotConnected | FigmaAuthInvalid | FigmaError>
}

export class FigmaIntegrations extends Context.Tag("FigmaIntegrations")<
  FigmaIntegrations,
  FigmaIntegrationsShape
>() {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/backend vitest run src/Layers/FigmaIntegrations.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the live layer**

Create `packages/backend/src/Layers/FigmaIntegrations.ts`. Read `packages/backend/src/Layers/EverhourIntegrations.ts` first and follow its structure for project-link lookup, membership checks and status mapping.

Required behaviour:

- **Secrets.** Every stored token goes through `SecretCrypto.seal` on write and `SecretCrypto.open` on read, into the three-column shape from Task 3.
- **`beginProfileConnect`** builds `https://www.figma.com/oauth?client_id=…&redirect_uri=…&scope=…&state=…&response_type=code` with scopes `file_content:read file_metadata:read file_dev_resources:read file_dev_resources:write`, and a cryptographically random `state` persisted for single use.
- **`completeProfileConnect`** rejects an unknown or already-consumed `state`, then `POST`s to `https://api.figma.com/v1/oauth/token` with `Authorization: Basic base64(client_id:client_secret)` and `redirect_uri`, `code`, `grant_type=authorization_code` form-encoded. Authorization codes expire 30 seconds after issue, so no retry/backoff around this call. Stores access token, refresh token and `expiresAt = now + expires_in`, then calls `Figma.getMe` to record identity.
- **`credentialFor`** reads the personal row for `userId` (when non-null) and the project row, and passes both to `chooseCredential`. When the chosen credential is the personal one and `isTokenExpired(expiresAt, now)`, refresh first via `POST https://api.figma.com/v1/oauth/refresh` with the same Basic header, persist the new token and expiry, and use it. A failed refresh clears `lastCheckStatus` to `"error"` and fails `FigmaAuthInvalid`. When `chooseCredential` returns `null`, fail `FigmaNotConnected`.
- **`connectProject`** fails `StorageNotConnected` before touching Figma if org storage is not connected. Then verifies the PAT with `Figma.getMe` — an invalid token fails `FigmaAuthInvalid` and nothing is stored — and only then seals and stores it.
- **`getProjectStatus`** reports `storageConnected` so the UI can show the precondition without a second round-trip.
- Requires project membership for the project-scoped calls, matching how `EverhourIntegrations` enforces it.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
bun run --cwd packages/backend vitest run src/Layers/FigmaIntegrations.test.ts
git add packages/backend/src/Services/FigmaIntegrations.ts \
  packages/backend/src/Layers/FigmaIntegrations.ts \
  packages/backend/src/Layers/FigmaIntegrations.test.ts
git commit -m "feat(figma): resolve credentials across personal and project connections"
```

---

## Task 6: HttpApi group, handlers and OAuth routes

**Files:**
- Modify: `packages/shared/src/api.ts`
- Create: `packages/backend/src/handlers/figma.ts`
- Create: `packages/backend/src/http/figmaOauthRoutes.ts`
- Modify: the API/layer wiring files that register groups and layers

**Interfaces:**
- Consumes: Tasks 2 and 5.
- Produces: `FigmaGroup` with endpoints `profile`, `disconnectProfile`, `projectStatus`, `connectProject`, `disconnectProject`, `ticketLinks`.

- [ ] **Step 1: Add the endpoint group**

Add to `packages/shared/src/api.ts`, mirroring `EverhourGroup`'s construction, and register it on the top-level `HttpApi` the same way `EverhourGroup` is registered:

```ts
const FigmaGroup = HttpApiGroup.make("figma")
  .add(
    HttpApiEndpoint.get("profile", "/integrations/figma/profile")
      .addSuccess(PersonalFigma)
      .addError(Unauthorized)
  )
  .add(
    HttpApiEndpoint.del("disconnectProfile", "/integrations/figma/profile")
      .addSuccess(PersonalFigma)
      .addError(Unauthorized)
  )
  .add(
    HttpApiEndpoint.get(
      "projectStatus",
      "/orgs/:orgSlug/projects/:slug/integrations/figma"
    )
      .setPath(ProjectPath)
      .addSuccess(FigmaProjectIntegrationStatus)
      .addError(Unauthorized)
      .addError(NotFound)
  )
  .add(
    HttpApiEndpoint.post(
      "connectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/figma/connect"
    )
      .setPath(ProjectPath)
      .setPayload(ConnectFigmaProjectInput)
      .addSuccess(FigmaProjectIntegrationStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
      .addError(StorageNotConnected)
      .addError(FigmaAuthInvalid)
      .addError(FigmaRateLimited)
      .addError(FigmaError)
  )
  .add(
    HttpApiEndpoint.del(
      "disconnectProject",
      "/orgs/:orgSlug/projects/:slug/integrations/figma"
    )
      .setPath(ProjectPath)
      .addSuccess(FigmaProjectIntegrationStatus)
      .addError(Unauthorized)
      .addError(NotFound)
      .addError(Forbidden)
  )
  .add(
    HttpApiEndpoint.get(
      "ticketLinks",
      "/orgs/:orgSlug/projects/:slug/tickets/:id/figma/links"
    )
      .setPath(TicketPath)
      .addSuccess(Schema.Array(FigmaLinkMetadata))
      .addError(Unauthorized)
      .addError(NotFound)
  )
```

Use whatever the file already names its ticket-scoped path schema — check with `grep -n "TicketPath\|tickets/:id" packages/shared/src/api.ts | head` and reuse the existing one rather than defining a new schema.

- [ ] **Step 2: Write the handlers**

Create `packages/backend/src/handlers/figma.ts`, following the structure of `packages/backend/src/handlers/everhour.ts`: one `HttpApiBuilder.group` covering the six endpoints, each delegating straight to `FigmaIntegrations` (or `FigmaLinks.listForTicket` for `ticketLinks`, added in Task 7) with the authed user id from the existing auth middleware.

- [ ] **Step 3: Write the OAuth routes**

Create `packages/backend/src/http/figmaOauthRoutes.ts` with two routes, registered the same way `packages/backend/src/http/attachmentRoutes.ts` is registered (they sit outside HttpApi because they redirect rather than return JSON):

- `GET /api/integrations/figma/oauth/start` → `beginProfileConnect`, then a 302 to the returned `authorizeUrl`.
- `GET /api/integrations/figma/oauth/callback` → reads `code` and `state`, calls `completeProfileConnect`, then a 302 back to the profile settings page. On failure, redirect to the same page with an error query param rather than rendering an error body.

Register this exact callback path in the Figma app's allowed redirect URLs, for both localhost and production.

- [ ] **Step 4: Wire the layers**

Add `FigmaLive` and `FigmaIntegrationsLive` to the backend layer composition beside `EverhourIntegrationsLive`. Find the composition root with:

Run: `grep -rn "EverhourIntegrationsLive" packages/backend/src | grep -v "\.test\."`

- [ ] **Step 5: Typecheck and verify the server boots**

```bash
bun run typecheck
bun run --cwd packages/backend dev
```

Expected: server starts with no missing-layer errors. Stop it once confirmed.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/backend/src/handlers/figma.ts \
  packages/backend/src/http/figmaOauthRoutes.ts
git add -u
git commit -m "feat(figma): expose connection endpoints and oauth callback"
```

---

## Task 7: Reconciliation and metadata cache

The heart of the feature. The reference delta computed here drives both the metadata cache and, in Task 8, the Dev Mode backlink.

**Files:**
- Create: `packages/backend/src/Services/FigmaLinks.ts`
- Create: `packages/backend/src/Layers/FigmaLinks.ts`
- Test: `packages/backend/src/Layers/FigmaLinks.test.ts`
- Modify: `packages/backend/src/Layers/Tickets.ts`

**Interfaces:**
- Consumes: Task 1's `extractFigmaRefs`/`figmaRefKey`; Task 3's tables; Task 4's `Figma`; Task 5's `credentialFor`; `OrgStorage`.
- Produces: `FigmaLinks` tag with `reconcileTicket(orgSlug, slug, ticketId, body): Effect.Effect<void>` and `listForTicket(orgSlug, userId, slug, ticketId): Effect.Effect<ReadonlyArray<FigmaLinkMetadata>, NotFound | Forbidden>`; pure `planFigmaReferences`.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/src/Layers/FigmaLinks.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { planFigmaReferences } from "../Services/FigmaLinks"

describe("planFigmaReferences", () => {
  it("adds a reference that appears in the body", () => {
    expect(
      planFigmaReferences({ existing: new Set(), referenced: new Set(["k/1:2"]) })
    ).toEqual({ added: ["k/1:2"], removed: [] })
  })

  it("removes a reference that left the body", () => {
    expect(
      planFigmaReferences({ existing: new Set(["k/1:2"]), referenced: new Set() })
    ).toEqual({ added: [], removed: ["k/1:2"] })
  })

  it("leaves an unchanged reference alone", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["k/1:2"]),
        referenced: new Set(["k/1:2"])
      })
    ).toEqual({ added: [], removed: [] })
  })

  it("handles a simultaneous add and remove", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["k/1:2"]),
        referenced: new Set(["k/3:4"])
      })
    ).toEqual({ added: ["k/3:4"], removed: ["k/1:2"] })
  })

  it("removes everything when the body is emptied", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["a/1:2", "b/3:4"]),
        referenced: new Set()
      })
    ).toEqual({ added: [], removed: ["a/1:2", "b/3:4"] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/backend vitest run src/Layers/FigmaLinks.test.ts`
Expected: FAIL — cannot resolve `../Services/FigmaLinks`.

- [ ] **Step 3: Write the service interface and the pure planner**

Create `packages/backend/src/Services/FigmaLinks.ts`:

```ts
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  FigmaLinkMetadata,
  Forbidden,
  NotFound
} from "@projectproject/shared"

export interface FigmaReferencePlan {
  readonly added: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
}

export const planFigmaReferences = (input: {
  readonly existing: ReadonlySet<string>
  readonly referenced: ReadonlySet<string>
}): FigmaReferencePlan => ({
  added: [...input.referenced].filter((key) => !input.existing.has(key)),
  removed: [...input.existing].filter((key) => !input.referenced.has(key))
})

export interface FigmaLinksShape {
  readonly reconcileTicket: (
    orgSlug: string,
    slug: string,
    ticketId: string,
    body: string
  ) => Effect.Effect<void>
  readonly listForTicket: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: string
  ) => Effect.Effect<ReadonlyArray<FigmaLinkMetadata>, NotFound | Forbidden>
}

export class FigmaLinks extends Context.Tag("FigmaLinks")<
  FigmaLinks,
  FigmaLinksShape
>() {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/backend vitest run src/Layers/FigmaLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the live layer**

Create `packages/backend/src/Layers/FigmaLinks.ts`, following `packages/backend/src/Layers/Attachments.ts`'s `reconcileTicket` (line ~531) for transaction and delta structure.

`reconcileTicket` behaviour:

1. `extractFigmaRefs(body)` → keys via `figmaRefKey`.
2. Read existing `figmaReference` rows for the ticket; compute `planFigmaReferences`.
3. For each added ref, upsert `figmaLinkIndex` on `(orgSlug, fileKey, nodeId)` — matching `nodeId IS NULL` explicitly for file-level refs — then insert the `figmaReference` row.
4. Delete removed `figmaReference` rows.
5. Fork metadata resolution for added refs so the ticket save never waits on Figma.

Metadata resolution, per added ref:

- `credentialFor(orgSlug, slug, null)` — resolution runs outside a user request, so it uses the project credential. A `FigmaNotConnected` failure here is normal and expected; log at debug and stop, leaving `name` null so the chip falls back to its URL slug.
- `Figma.getFile` for the file name; `Figma.getNodeName` additionally when `nodeId` is non-null.
- `Figma.renderNode` → write the PNG to `OrgStorage` under a key derived from `(orgSlug, fileKey, nodeId)`; store that key in `thumbnailKey`.
- Write `name`, `fileName`, `lastModified`, `fetchedAt`, and `lastCheckStatus`.
- On any `FigmaCallError`, record `lastCheckStatus: "error"` plus the reason and stop. Never propagate.

**`reconcileTicket` returns `Effect.Effect<void>` with no error channel**, exactly like `attachments.reconcileTicket`. Every Figma failure is caught and recorded. This is what makes the ticket save safe.

`listForTicket` joins `figmaReference` to `figmaLinkIndex`, returning `FigmaLinkMetadata` with `thumbnailUrl` built from `thumbnailKey`, and `name` falling back to `fileName` when the node name is unresolved.

- [ ] **Step 6: Call it from Tickets**

In `packages/backend/src/Layers/Tickets.ts`, add a `figmaLinks.reconcileTicket(...)` call immediately after each of the four existing `attachments.reconcileTicket(...)` calls (around lines 647, 709, 780 and 804), passing identical arguments — including the `""` body on the remove path, which is what retracts every reference and its backlink when a ticket is deleted.

- [ ] **Step 7: Verify the whole backend suite still passes**

Run: `bun run --cwd packages/backend vitest run`
Expected: PASS, including the existing ticket tests.

- [ ] **Step 8: Commit**

```bash
bun run typecheck
git add packages/backend/src/Services/FigmaLinks.ts \
  packages/backend/src/Layers/FigmaLinks.ts \
  packages/backend/src/Layers/FigmaLinks.test.ts \
  packages/backend/src/Layers/Tickets.ts
git commit -m "feat(figma): reconcile ticket bodies into figma references"
```

---

## Task 8: Dev Mode backlink

**Files:**
- Modify: `packages/backend/src/Layers/FigmaLinks.ts`
- Modify: `packages/backend/src/Layers/FigmaLinks.test.ts`

**Interfaces:**
- Consumes: Task 4's `createDevResource`/`deleteDevResource`; Task 7's reference delta.
- Produces: `figmaReference.devResourceId` populated on add, cleared on remove; pure `devResourceName`.

- [ ] **Step 1: Write the failing test**

Append to `packages/backend/src/Layers/FigmaLinks.test.ts`:

```ts
import { devResourceName, shouldBacklink } from "../Services/FigmaLinks"

describe("devResourceName", () => {
  it("names the resource after the ticket", () => {
    expect(devResourceName("T-51", "Figma integration")).toBe(
      "T-51 · Figma integration"
    )
  })

  it("truncates a very long title", () => {
    const name = devResourceName("T-51", "x".repeat(200))
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.startsWith("T-51 · ")).toBe(true)
  })
})

describe("shouldBacklink", () => {
  it("backlinks a node-level reference", () => {
    expect(shouldBacklink({ nodeId: "1:2" })).toBe(true)
  })

  it("skips a file-level reference", () => {
    expect(shouldBacklink({ nodeId: null })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/backend vitest run src/Layers/FigmaLinks.test.ts`
Expected: FAIL — `devResourceName` is not exported.

- [ ] **Step 3: Write the pure helpers**

Add to `packages/backend/src/Services/FigmaLinks.ts`:

```ts
export const DEV_RESOURCE_NAME_MAX = 100

export const devResourceName = (ticketId: string, title: string): string => {
  const prefix = `${ticketId} · `
  const room = DEV_RESOURCE_NAME_MAX - prefix.length
  return `${prefix}${title.slice(0, room)}`
}

export const shouldBacklink = (ref: {
  readonly nodeId: string | null
}): boolean => ref.nodeId !== null
```

Dev resources attach to a node, so a file-level reference has nothing to attach to.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run --cwd packages/backend vitest run src/Layers/FigmaLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the backlink into reconciliation**

In `packages/backend/src/Layers/FigmaLinks.ts`, inside the forked resolution work:

- For each **added** ref where `shouldBacklink(ref)`, call `Figma.createDevResource` with the ticket's absolute URL and `devResourceName(ticketId, title)`, storing the returned id in `figmaReference.devResourceId`.
- For each **removed** ref that had a `devResourceId`, call `Figma.deleteDevResource` before deleting the row.
- Wrap both in the same catch-and-record used for metadata. A Figma failure leaves the reference row correct and the backlink stale; the next reconciliation of that ticket retries.

The ticket's absolute URL needs the app's public base URL. Reuse whatever config the existing code uses for absolute links — find it with `grep -rn "BASE_URL\|PUBLIC_URL\|appUrl" packages/backend/src | grep -v "\.test\."` and follow that, rather than introducing a new environment variable.

- [ ] **Step 6: Typecheck, test and commit**

```bash
bun run typecheck
bun run --cwd packages/backend vitest run
git add packages/backend/src/Services/FigmaLinks.ts \
  packages/backend/src/Layers/FigmaLinks.ts \
  packages/backend/src/Layers/FigmaLinks.test.ts
git commit -m "feat(figma): write ticket backlinks as dev resources"
```

---

## Task 9: Frontend atoms

**Files:**
- Create: `packages/frontend/src/atoms/figma.ts`

**Interfaces:**
- Consumes: Task 6's endpoints.
- Produces: `figmaProfileAtom`, `connectFigmaProfileAtom`, `disconnectFigmaProfileAtom`, `figmaProjectStatusAtom`, `connectFigmaProjectAtom`, `disconnectFigmaProjectAtom`, `figmaTicketLinksAtom`.

- [ ] **Step 1: Write the atoms**

Create `packages/frontend/src/atoms/figma.ts` following `packages/frontend/src/atoms/everhour.ts` exactly for client construction and runtime wiring, and `packages/frontend/src/atoms/github.ts` for the optimistic shape.

Requirements from the Global Constraints:

- Project-scoped atoms are `Atom.family` keyed by `projectKey(orgSlug, slug)`; ticket-scoped by `ticketKey(orgSlug, slug, id)`.
- Reads split into a private `…BaseAtom` plus an exported `Atom.optimistic` wrapper.
- Connect/disconnect are `Atom.optimisticFn` over the status atom, with a reducer flipping `connected` and setting `{ waiting: true }`, refreshing the **base** atom after the call lands.
- `figmaTicketLinksAtom` is a plain `runtime.atom` read — there is nothing to synthesise optimistically for it.

- [ ] **Step 2: Typecheck and commit**

```bash
bun run typecheck
git add packages/frontend/src/atoms/figma.ts
git commit -m "feat(figma): add figma connection and link atoms"
```

---

## Task 10: The Lexical node

**Files:**
- Create: `packages/frontend/src/components/Lexical/FigmaNode.tsx`
- Create: `packages/frontend/src/components/Lexical/FigmaChip.tsx`
- Create: `packages/frontend/src/components/Lexical/FigmaEmbed.tsx`
- Create: `packages/frontend/src/components/Lexical/figmaTransformer.ts`
- Create: `packages/frontend/src/components/Lexical/FigmaExtension.ts`
- Create: `packages/frontend/src/components/Lexical/FigmaPlugin.tsx`
- Test: `packages/frontend/src/components/Lexical/figmaTransformer.test.ts`
- Modify: `packages/frontend/src/components/LexicalEditor.tsx`

**Interfaces:**
- Consumes: Task 1's URL helpers; Task 9's `figmaTicketLinksAtom`.
- Produces: `FigmaNode`, `$createFigmaNode`, `$isFigmaNode`, `FIGMA_TRANSFORMER`, `FigmaExtension`, `FigmaPlugin`.

- [ ] **Step 1: Write the failing test**

Create `packages/frontend/src/components/Lexical/figmaTransformer.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { FIGMA_MARKDOWN_RE, formatFigmaMarkdown } from "./figmaTransformer"

const KEY = "aBcDeF1234567890GhIjKl"

describe("formatFigmaMarkdown", () => {
  it("writes a plain markdown link", () => {
    expect(
      formatFigmaMarkdown({
        label: "Checkout",
        url: `https://figma.com/design/${KEY}/Checkout?node-id=1-2`,
        density: "rich"
      })
    ).toBe(`[Checkout](https://figma.com/design/${KEY}/Checkout?node-id=1-2)`)
  })

  it("carries compact density on the url", () => {
    const out = formatFigmaMarkdown({
      label: "Checkout",
      url: `https://figma.com/design/${KEY}/Checkout`,
      density: "compact"
    })
    expect(out).toContain("pp-density=compact")
  })

  it("escapes brackets in the label", () => {
    const out = formatFigmaMarkdown({
      label: "A [weird] name",
      url: `https://figma.com/design/${KEY}/A`,
      density: "rich"
    })
    expect(out).toContain("A \\[weird\\] name")
  })
})

describe("FIGMA_MARKDOWN_RE", () => {
  it("matches a figma markdown link", () => {
    const md = `[Checkout](https://figma.com/design/${KEY}/Checkout?node-id=1-2)`
    expect(FIGMA_MARKDOWN_RE.test(md)).toBe(true)
  })

  it("does not match a non-figma link", () => {
    expect(FIGMA_MARKDOWN_RE.test("[Docs](https://example.test/a)")).toBe(false)
  })

  it("does not match an attachment link", () => {
    expect(
      FIGMA_MARKDOWN_RE.test("[f](/api/attachments/acme/01JBX7Q2K9ZWCVE8MTQ4RXPGHN)")
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run --cwd packages/frontend vitest run src/components/Lexical/figmaTransformer.test.ts`
Expected: FAIL — cannot resolve `./figmaTransformer`.

- [ ] **Step 3: Write the transformer**

Create `packages/frontend/src/components/Lexical/figmaTransformer.ts`, modelled directly on `attachmentTransformer.ts`:

```ts
import type { TextMatchTransformer } from "@lexical/markdown"
import { $createTextNode } from "lexical"
import {
  figmaSrc,
  figmaViewParams,
  parseFigmaUrl,
  withFigmaParams,
  type FigmaDensity
} from "@projectproject/shared"
import { $createFigmaNode, $isFigmaNode, FigmaNode } from "./FigmaNode"

export const FIGMA_MARKDOWN_RE =
  /\[((?:\\.|[^\]\\])*)\]\((https?:\/\/(?:www\.)?figma\.com\/(?:design|board|slides|proto|file)\/[^)\s]+)\)/

export const formatFigmaMarkdown = (input: {
  readonly label: string
  readonly url: string
  readonly density: FigmaDensity
}): string => {
  const label = input.label.replace(/([[\]\\])/g, "\\$1")
  return `[${label}](${withFigmaParams(input.url, { density: input.density })})`
}

export const unescapeFigmaLabel = (label: string): string =>
  label.replace(/\\(.)/g, "$1")

export const FIGMA_TRANSFORMER: TextMatchTransformer = {
  dependencies: [FigmaNode],
  export: (node) => {
    if (!$isFigmaNode(node)) return null
    return formatFigmaMarkdown({
      label: node.getLabel(),
      url: node.getUrl(),
      density: node.getDensity()
    })
  },
  importRegExp: FIGMA_MARKDOWN_RE,
  regExp: new RegExp(`${FIGMA_MARKDOWN_RE.source}$`),
  replace: (textNode, match) => {
    const [, rawLabel, url] = match
    const ref = url === undefined ? null : parseFigmaUrl(url)
    if (url === undefined || ref === null) {
      textNode.replace($createTextNode(match[0]))
      return
    }
    textNode.replace(
      $createFigmaNode({
        url: figmaSrc(url),
        label: unescapeFigmaLabel(rawLabel ?? ""),
        ref,
        density: figmaViewParams(url).density
      })
    )
  },
  trigger: ")",
  type: "text-match"
}
```

- [ ] **Step 4: Write the node and its two presentations**

Create `FigmaNode.tsx` as a `DecoratorNode` mirroring `AttachmentNode.tsx`:

- Payload: `{ url, label, ref, density }`. Serialization: `exportJSON`/`importJSON` carrying `url`, `label`, `density`.
- Getters `getUrl`, `getLabel`, `getDensity`, `getRef`; setter `setDensity`.
- Compact renders `FigmaChip`; rich renders `FigmaEmbed`. Morph between them with `motion` `LayoutGroup` and the shared `transitions.morph`, as `AttachmentNode` does.
- Selection, `CLICK_COMMAND`, `KEY_BACKSPACE_COMMAND`, `KEY_DELETE_COMMAND` and `KEY_ESCAPE_COMMAND` handling copied in structure from `AttachmentNode`.

`FigmaChip.tsx`: Figma glyph plus the resolved name, using the node name with the file name as the `title` attribute. Falls back to the URL slug while unresolved (`m.figma_chip_loading()` when there is no slug either), and to `m.figma_chip_unavailable()` on an unresolvable link.

`FigmaEmbed.tsx`: an iframe at `figmaEmbedUrl(ref, url)` with `allowfullscreen`, a 16:9 aspect box, and an "Open in Figma" link. Overlay controls reuse `AttachmentNode`'s `OVERLAY_REVEAL` / `OVERLAY_BUTTON` treatment, with `group/reveal` + `group-hover/reveal:*` for the hover-revealed actions.

All buttons take `active:scale-[0.97] transition-transform duration-100`; all hover colour changes are paired with `transition-colors`.

- [ ] **Step 5: Write the extension and paste plugin**

`FigmaExtension.ts`:

```ts
import { defineExtension } from "lexical"
import { FigmaNode } from "./FigmaNode"

export const FigmaExtension = defineExtension({
  name: "@projectproject/figma",
  nodes: [FigmaNode]
})
```

`FigmaPlugin.tsx` mirrors `AttachmentsPlugin.tsx`: on paste, if the clipboard text is a single URL that `parseFigmaUrl` accepts, insert a `FigmaNode` at `density: "compact"` instead of plain text.

- [ ] **Step 6: Register in the editor**

In `packages/frontend/src/components/LexicalEditor.tsx`, add `FigmaExtension` beside `AttachmentExtension`, and `FIGMA_TRANSFORMER` to `MARKDOWN_TRANSFORMERS` (line ~60). It goes in the **base** `MARKDOWN_TRANSFORMERS` list, not the attachment-only list, so Figma links work in every editor surface regardless of whether attachments are enabled there. Place it **before** `...TRANSFORMERS` so it wins over the generic link transformer.

- [ ] **Step 7: Run test to verify it passes**

```bash
bun run --cwd packages/frontend vitest run src/components/Lexical/figmaTransformer.test.ts
bun run --cwd packages/frontend vitest run src/components/LexicalEditor.test.ts
```
Expected: PASS both — the second guards against the new transformer disturbing existing markdown round-trips.

- [ ] **Step 8: Typecheck and commit**

```bash
bun run typecheck
git add packages/frontend/src/components/Lexical/Figma*.tsx \
  packages/frontend/src/components/Lexical/figmaTransformer.ts \
  packages/frontend/src/components/Lexical/figmaTransformer.test.ts \
  packages/frontend/src/components/Lexical/FigmaExtension.ts \
  packages/frontend/src/components/LexicalEditor.tsx
git commit -m "feat(figma): render figma links as chips that expand to embeds"
```

---

## Task 11: Settings surfaces

**Files:**
- Create: `packages/frontend/src/components/settings/FigmaProfileSettings.tsx`
- Create: `packages/frontend/src/components/settings/FigmaProjectSettings.tsx`
- Modify: the profile and project settings routes

**Interfaces:**
- Consumes: Task 9's atoms.
- Produces: two rendered panels.

- [ ] **Step 1: Build the profile panel**

`FigmaProfileSettings.tsx`: renders `figmaProfileAtom` through `Result.matchWithError` with `ErrorPage contained`. Disconnected shows `m.figma_profile_connect_button()` linking to `/api/integrations/figma/oauth/start`; connected shows `m.figma_profile_connected_status({ handle })` and a disconnect button. Place it beside the existing Everhour profile panel — find it with `grep -rn "profile_everhour" packages/frontend/src/routes packages/frontend/src/components | head`.

- [ ] **Step 2: Build the project panel**

`FigmaProjectSettings.tsx`: same `Result.matchWithError` treatment. When `storageConnected` is false, render `m.figma_project_storage_required()` and disable the connect control — the precondition is visible before the user types a token, not after. Otherwise a password-type input for the PAT plus a connect button, reading `waiting` and `Result.isFailure` straight off the mutation atom rather than mirroring into `useState`.

- [ ] **Step 3: Verify in the browser**

```bash
bun run dev
```

Check: the profile panel renders both states, the project panel shows the storage precondition when storage is disconnected, and connecting a real PAT flips it to connected.

Note that `bun run dev` clobbers env overrides — if running against a worktree database, start the backend and frontend separately with the intended env rather than through the combined script.

- [ ] **Step 4: Typecheck and commit**

```bash
bun run typecheck
git add packages/frontend/src/components/settings/Figma*.tsx
git add -u
git commit -m "feat(figma): add profile and project connection settings"
```

---

## Task 12: Environment documentation and end-to-end verification

**Files:**
- Modify: `.env.example`, `.env.production.example`

- [ ] **Step 1: Document the environment variables**

Add to both `.env.example` and `.env.production.example`, matching each file's existing comment style:

```
FIGMA_CLIENT_ID=
FIGMA_CLIENT_SECRET=
```

- [ ] **Step 2: Run the full suite**

```bash
bun run typecheck
bun run lint
bun test
```
Expected: all green.

- [ ] **Step 3: End-to-end walkthrough**

With the app running and Figma connected on a project:

1. Paste a Figma frame URL into a ticket description → a compact chip appears showing the frame name.
2. Expand it → the live embed renders.
3. Reload the page → the chip returns at its saved density.
4. Read the ticket's markdown on disk → it contains a plain `[name](figma url)` link.
5. Open the frame in Figma's Dev Mode → the ticket appears as a linked dev resource.
6. Delete the link from the description and save → the dev resource disappears from the frame.

Step 6 is the one most likely to be quietly broken, since it depends on the removal path of the reconciliation delta. Verify it explicitly rather than assuming it from step 5 working.

- [ ] **Step 4: Commit**

```bash
git add .env.example .env.production.example
git commit -m "docs(figma): document figma oauth environment variables"
```

- [ ] **Step 5: Note the production deployment step**

`docker-compose.prod.yml` reads `env_file: /srv/projectproject/.env` on the droplet. `FIGMA_CLIENT_ID` and `FIGMA_CLIENT_SECRET` must be added to that file on the host before the feature works in production; nothing in the repo does this. Flag it in the PR description.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: connections and the `credentialFor` seam → Task 5; the two credential types → Tasks 4 and 5; OAuth app configuration → Tasks 5, 6 and 12; URL parsing → Task 1; the editor node and all four of its states → Task 10; metadata and thumbnails → Task 7; reconciliation → Task 7; Dev Mode backlink → Task 8; frontend state → Task 9; i18n → Task 2; testing → distributed across each task's TDD cycle; build order → Tasks 1–12 follow the spec's order, with settings (Task 11) after the node so the connection UI can be tested against a working feature.

**Storage precondition** appears in three places by design: enforced in `connectProject` (Task 5), reported through `getProjectStatus` (Task 5), and surfaced in the UI (Task 11).

**Type consistency.** `FigmaRef`, `FigmaDensity`, `FigmaCredential`, `figmaRefKey` and `FigmaLinkMetadata` are defined once and referenced by identical names throughout. `reconcileTicket` has the same four-argument signature as `attachments.reconcileTicket` and the same `Effect.Effect<void>` no-error type in both Task 7's interface and Task 7's Tickets wiring.

**Two things deliberately left as read-then-follow** rather than invented, because guessing them would produce wrong code: the exact paraglide compile script name (Task 2), and the existing public-base-URL config (Task 8). Both steps say how to find the answer.

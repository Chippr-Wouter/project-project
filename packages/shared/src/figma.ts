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

const isFigmaHost = (host: string): boolean => {
  const lower = host.toLowerCase()
  return lower === "figma.com" || lower === "www.figma.com"
}

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
  const proto = parsed.protocol.toLowerCase()
  if (proto !== "https:" && proto !== "http:") return null
  if (!isFigmaHost(parsed.hostname)) return null

  const segments = parsed.pathname.split("/").filter((part) => part.length > 0)
  const [segment, fileKey, slug] = segments
  if (segment === undefined || fileKey === undefined) return null

  const kind = SEGMENT_KINDS[segment]
  if (kind === undefined) return null
  if (!FILE_KEY_PATTERN.test(fileKey)) return null

  let decodedSlug: string
  try {
    decodedSlug = slug === undefined ? "" : decodeURIComponent(slug)
  } catch {
    return null
  }

  return {
    kind,
    fileKey,
    nodeId: normaliseNodeId(parsed.searchParams.get("node-id")),
    slug: decodedSlug
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

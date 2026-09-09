import { ULID_PATTERN } from "./schemas/Attachment"
import { SLUG_PATTERN } from "./schemas/Project"

export const ATTACHMENT_URL_PREFIX = "/api/attachments"

export const attachmentUrl = (orgSlug: string, id: string): string =>
  `${ATTACHMENT_URL_PREFIX}/${orgSlug}/${id}`

export const attachmentDownloadUrl = (orgSlug: string, id: string): string =>
  `${attachmentUrl(orgSlug, id)}?download=1`

export interface AttachmentRef {
  readonly orgSlug: string
  readonly id: string
}

const stripQuery = (url: string): string => {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

export const parseAttachmentUrl = (url: string): AttachmentRef | null => {
  if (!url.startsWith(`${ATTACHMENT_URL_PREFIX}/`)) return null
  const rest = stripQuery(url).slice(ATTACHMENT_URL_PREFIX.length + 1)
  const parts = rest.split("/")
  if (parts.length !== 2) return null
  const [orgSlug, id] = parts
  if (!orgSlug || !id) return null
  if (!SLUG_PATTERN.test(orgSlug)) return null
  if (!ULID_PATTERN.test(id)) return null
  return { orgSlug, id }
}

const WIDTH_PARAM = "w"

const DENSITY_PARAM = "d"

export type AttachmentDensity = "rich" | "compact"

export interface AttachmentViewParams {
  readonly width: number | null
  readonly density: AttachmentDensity
}

const searchParams = (url: string): URLSearchParams => {
  const cut = url.search(/[?#]/)
  if (cut === -1 || url[cut] === "#") return new URLSearchParams()
  return new URLSearchParams(stripQuery(url.slice(cut + 1)))
}

export const attachmentViewParams = (url: string): AttachmentViewParams => {
  const params = searchParams(url)
  const raw = params.get(WIDTH_PARAM)
  const parsed = raw === null ? Number.NaN : Number(raw)
  return {
    width: Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    density: params.get(DENSITY_PARAM) === "compact" ? "compact" : "rich"
  }
}

export const attachmentSrc = (url: string): string => stripQuery(url)

export const withAttachmentParams = (
  url: string,
  params: {
    readonly width?: number | null
    readonly density?: AttachmentDensity
  }
): string => {
  const base = stripQuery(url)
  const query: Array<string> = []
  const width = params.width ?? null
  if (width !== null && Number.isFinite(width) && width > 0) {
    query.push(
      `${WIDTH_PARAM}=${encodeURIComponent(Math.max(1, Math.round(width)))}`
    )
  }
  if (params.density === "compact") {
    query.push(`${DENSITY_PARAM}=compact`)
  }
  return query.length === 0 ? base : `${base}?${query.join("&")}`
}

export const formatAttachmentMarkdown = (input: {
  readonly kind: "image" | "file"
  readonly alt: string
  readonly url: string
  readonly width?: number | null
  readonly density?: AttachmentDensity
}): string => {
  const alt = input.alt.replace(/([[\]\\*_`~&<>])/g, "\\$1")
  const url = withAttachmentParams(input.url, {
    width: input.width,
    density: input.density
  })
  return `${input.kind === "image" ? "!" : ""}[${alt}](${url})`
}

const unanchored = (pattern: RegExp) => pattern.source.replace(/^\^|\$$/g, "")

const ATTACHMENT_URL_CANDIDATE_RE = new RegExp(
  `${ATTACHMENT_URL_PREFIX}/(?:${unanchored(SLUG_PATTERN)})/(?:${unanchored(ULID_PATTERN)})`,
  "g"
)

export const extractAttachmentRefs = (
  markdown: string
): ReadonlyArray<AttachmentRef> => {
  const seen = new Set<string>()
  const out: AttachmentRef[] = []
  for (const match of markdown.matchAll(ATTACHMENT_URL_CANDIDATE_RE)) {
    const ref = parseAttachmentUrl(match[0])
    if (ref === null) continue
    const key = `${ref.orgSlug}/${ref.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ref)
  }
  return out
}

export type AttachmentFileFormat = "pdf" | "zip" | "tar" | "gzip" | "generic"

const FORMAT_SUFFIXES: ReadonlyArray<
  readonly [suffix: string, format: AttachmentFileFormat]
> = [
  [".pdf", "pdf"],
  [".zip", "zip"],
  [".tar.gz", "gzip"],
  [".tgz", "gzip"],
  [".gz", "gzip"],
  [".gzip", "gzip"],
  [".tar", "tar"]
]

export const attachmentFileFormat = (
  filename: string
): AttachmentFileFormat => {
  const name = filename.trim().toLowerCase()
  for (const [suffix, format] of FORMAT_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) return format
  }
  return "generic"
}

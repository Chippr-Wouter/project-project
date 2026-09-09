import { useAtomValue } from "@effect/atom-react"
import { ExternalLink } from "lucide-react"
import {
  figmaRefKey,
  figmaSrc,
  parseFigmaUrl,
  type FigmaRef,
  type TicketDetail
} from "@projectproject/shared"
import { ticketBodyDraftAtom, ticketKey } from "@/atoms/tickets"
import { FigmaGlyph, figmaDisplayName } from "@/components/Lexical/FigmaChip"
import {
  FigmaTicketProvider,
  useFigmaMetadata
} from "@/components/Lexical/figmaMetadata"
import { PaperGlyph } from "@/components/Lexical/PaperNode"
import { isPaperDesignUrl } from "@/components/Lexical/paperUrl"
import { MetaRow } from "@/components/TicketPage/MetaRow"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages"

export type TicketDesignLink =
  | {
      readonly kind: "figma"
      readonly url: string
      readonly label: string
      readonly reference: FigmaRef
    }
  | {
      readonly kind: "paper"
      readonly url: string
      readonly label: string
    }

const DESIGN_LINK_RE =
  /\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s)<>"']+)/gi

const unescapeLabel = (label: string): string => label.replace(/\\(.)/g, "$1")

const trimBareUrl = (url: string): string =>
  url.replace(/[.,;:!?}\]_*~]+$/g, "")

export function extractTicketDesignLinks(
  markdown: string
): ReadonlyArray<TicketDesignLink> {
  const seen = new Set<string>()
  const links: Array<TicketDesignLink> = []

  for (const match of markdown.matchAll(DESIGN_LINK_RE)) {
    const markdownUrl = match[2]
    const url = markdownUrl ?? trimBareUrl(match[3] ?? "")
    const label = markdownUrl === undefined ? "" : unescapeLabel(match[1] ?? "")
    const figmaReference = parseFigmaUrl(url)

    if (figmaReference !== null) {
      const key = `figma:${figmaRefKey(figmaReference)}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({
        kind: "figma",
        url: figmaSrc(url),
        label,
        reference: figmaReference
      })
      continue
    }

    if (!isPaperDesignUrl(url)) continue
    const key = `paper:${url}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ kind: "paper", url, label })
  }

  return links
}

function LinkContents({
  glyph,
  name
}: {
  glyph: React.ReactNode
  name: string
}) {
  return (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {glyph}
        <span className="truncate">{name}</span>
      </span>
      <ExternalLink
        className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    </>
  )
}

function FigmaDesignLink({
  link
}: {
  link: Extract<TicketDesignLink, { kind: "figma" }>
}) {
  const metadata = useFigmaMetadata(link.reference)
  const name = figmaDisplayName({
    resolved: metadata?.name ?? null,
    label: link.label,
    slug: link.reference.slug
  })
  const resolvedName = name || m.figma_chip_loading()

  return (
    <Button
      variant="sidebar-link"
      size="sm"
      render={
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          title={metadata?.fileName ?? resolvedName}
        />
      }
    >
      <LinkContents
        glyph={<FigmaGlyph className="h-3.5" />}
        name={resolvedName}
      />
    </Button>
  )
}

function PaperDesignLink({
  link
}: {
  link: Extract<TicketDesignLink, { kind: "paper" }>
}) {
  const name = link.label.trim() || m.editor_paper_default_name()

  return (
    <Button
      variant="sidebar-link"
      size="sm"
      render={
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          title={name}
        />
      }
    >
      <LinkContents
        glyph={<PaperGlyph className="size-3.5 shrink-0" />}
        name={name}
      />
    </Button>
  )
}

export function TicketDesignLinks({
  orgSlug,
  slug,
  ticket
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
}) {
  const key = ticketKey(orgSlug, slug, ticket.id)
  const bodyDraft = useAtomValue(ticketBodyDraftAtom(key))
  const links = extractTicketDesignLinks(bodyDraft ?? ticket.body)

  if (links.length === 0) return null

  return (
    <MetaRow label={m.tickets_page_meta_designs()}>
      <FigmaTicketProvider target={{ orgSlug, slug, ticketId: ticket.id }}>
        <div className="flex flex-col gap-0.5">
          {links.map((link) =>
            link.kind === "figma" ? (
              <FigmaDesignLink
                key={`figma:${figmaRefKey(link.reference)}`}
                link={link}
              />
            ) : (
              <PaperDesignLink key={`paper:${link.url}`} link={link} />
            )
          )}
        </div>
      </FigmaTicketProvider>
    </MetaRow>
  )
}

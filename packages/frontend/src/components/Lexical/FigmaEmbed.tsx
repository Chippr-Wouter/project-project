import { motion } from "motion/react"
import { ExternalLink } from "lucide-react"
import { figmaEmbedUrl, type FigmaRef } from "@projectproject/shared"
import { Button } from "@/components/ui/button"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { FigmaChip, FigmaGlyph, figmaDisplayName } from "./FigmaChip"
import { useFigmaMetadata } from "./figmaMetadata"

const EMBED_REVEAL =
  "opacity-0 transition-opacity group-hover/reveal:opacity-100 group-focus-within/reveal:opacity-100"

export function FigmaEmbed({
  reference,
  url,
  label,
  morphId
}: {
  reference: FigmaRef | null
  url: string
  label: string
  morphId: string
}) {
  const metadata = useFigmaMetadata(reference)

  if (reference === null) {
    return <FigmaChip reference={null} label={label} morphId={morphId} />
  }

  const name = figmaDisplayName({
    resolved: metadata?.name ?? null,
    label,
    slug: reference.slug
  })
  const resolvedName = name.length > 0 ? name : m.figma_chip_loading()

  return (
    <span className="group/reveal block w-[38rem] max-w-full overflow-hidden rounded-xl border border-border bg-card">
      <span
        className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5 text-xs"
        title={metadata?.fileName ?? resolvedName}
      >
        <motion.span
          layout="position"
          transition={transitions.morph}
          className="flex shrink-0 items-center"
        >
          <FigmaGlyph className="h-3.5" />
        </motion.span>
        <motion.span
          layoutId={`${morphId}-name`}
          layout="position"
          transition={transitions.morph}
          className={cn(
            "truncate",
            name.length === 0 && "text-muted-foreground"
          )}
        >
          {resolvedName}
        </motion.span>
      </span>
      <span className="relative block aspect-video w-full bg-muted">
        <iframe
          src={figmaEmbedUrl(reference, url)}
          title={resolvedName}
          loading="lazy"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"
          className="absolute inset-0 block size-full border-0"
        />
        <span className="absolute right-2 bottom-2">
          <Button
            variant="overlay"
            size="sm"
            trailingIcon={ExternalLink}
            className={EMBED_REVEAL}
            render={
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                data-figma-action="open"
                onMouseDown={(event) => event.stopPropagation()}
              />
            }
          >
            {m.figma_embed_open_in_figma()}
          </Button>
        </span>
      </span>
    </span>
  )
}

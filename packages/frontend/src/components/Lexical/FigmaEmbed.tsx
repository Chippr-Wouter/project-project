import { motion } from "motion/react"
import { figmaEmbedUrl, type FigmaRef } from "@projectproject/shared"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { FigmaChip, FigmaGlyph, figmaDisplayName } from "./FigmaChip"
import { useFigmaMetadata } from "./figmaMetadata"

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
    <span className="block w-[38rem] max-w-full overflow-hidden rounded-xl border border-border bg-card">
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
      </span>
    </span>
  )
}

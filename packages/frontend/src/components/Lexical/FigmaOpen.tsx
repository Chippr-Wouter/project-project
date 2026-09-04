import { motion } from "motion/react"
import { ExternalLink } from "lucide-react"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"

export function FigmaOpen({
  url,
  morphId
}: {
  url: string
  morphId: string
}) {
  return (
    <motion.a
      layoutId={`${morphId}-open`}
      layout="position"
      transition={transitions.morph}
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      data-figma-action="open"
      aria-label={m.figma_embed_open_in_figma()}
      title={m.figma_embed_open_in_figma()}
      onMouseDown={(event) => event.stopPropagation()}
      className="shrink-0 rounded text-muted-foreground transition-colors duration-100 hover:text-foreground active:[&>svg]:scale-[0.97] [&>svg]:transition-transform [&>svg]:duration-100"
    >
      <ExternalLink strokeWidth={1.75} className="size-3" aria-hidden="true" />
    </motion.a>
  )
}

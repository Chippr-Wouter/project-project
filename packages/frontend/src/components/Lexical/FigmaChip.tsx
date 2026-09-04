import { motion } from "motion/react"
import type { FigmaRef } from "@projectproject/shared"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { FigmaOpen } from "./FigmaOpen"
import { useFigmaMetadata } from "./figmaMetadata"

const CHIP =
  "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 align-baseline text-xs transition-colors duration-100 group-focus-within/editing:hover:bg-accent/40"

export function FigmaGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 38 57"
      aria-hidden="true"
      focusable="false"
      className={cn("w-auto shrink-0", className)}
    >
      <path fill="#1abcfe" d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" />
      <path fill="#0acf83" d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" />
      <path fill="#ff7262" d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" />
      <path fill="#f24e1e" d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" />
      <path fill="#a259ff" d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" />
    </svg>
  )
}

export const figmaSlugLabel = (slug: string): string =>
  slug.replace(/[-_]+/g, " ").trim()

export const figmaDisplayName = (input: {
  readonly resolved: string | null
  readonly label: string
  readonly slug: string
}): string => {
  const resolved = input.resolved?.trim() ?? ""
  if (resolved.length > 0) return resolved
  const label = input.label.trim()
  if (label.length > 0) return label
  return figmaSlugLabel(input.slug)
}

export function FigmaChip({
  reference,
  url,
  label,
  morphId
}: {
  reference: FigmaRef | null
  url?: string
  label: string
  morphId: string
}) {
  const metadata = useFigmaMetadata(reference)

  if (reference === null) {
    return (
      <span
        className={cn(
          CHIP,
          "border-dashed text-muted-foreground hover:bg-transparent"
        )}
      >
        <FigmaGlyph className="h-3 opacity-50" />
        {m.figma_chip_unavailable()}
      </span>
    )
  }

  const name = figmaDisplayName({
    resolved: metadata?.name ?? null,
    label,
    slug: reference.slug
  })
  const resolvedName = name.length > 0 ? name : m.figma_chip_loading()

  return (
    <span className={CHIP} title={metadata?.fileName ?? resolvedName}>
      <motion.span
        layout="position"
        transition={transitions.morph}
        className="flex shrink-0 items-center"
      >
        <FigmaGlyph className="h-3" />
      </motion.span>
      <motion.span
        layoutId={`${morphId}-name`}
        layout="position"
        transition={transitions.morph}
        className={cn("truncate", name.length === 0 && "text-muted-foreground")}
      >
        {resolvedName}
      </motion.span>
      {url === undefined ? null : <FigmaOpen url={url} morphId={morphId} />}
    </span>
  )
}

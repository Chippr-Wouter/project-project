import { useState } from "react"
import { motion } from "motion/react"
import { transitions } from "@/lib/springs"
import { AttachmentDownload } from "@/components/AttachmentDownload"
import { FileText, Image as ImageIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"

const CHIP =
  "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 align-baseline text-xs transition-colors duration-100 group-focus-within/editing:hover:bg-accent/40"

const HOVER_DELAY_MS = 450

function ChipBody({
  filename,
  kind,
  morphId
}: {
  filename: string
  kind: "image" | "file"
  morphId: string
}) {
  const Icon = kind === "image" ? ImageIcon : FileText
  return (
    <>
      <motion.span
        layout="position"
        transition={transitions.morph}
        className="flex shrink-0 items-center"
      >
        <Icon
          strokeWidth={1.75}
          className="size-3 text-muted-foreground"
          aria-hidden="true"
        />
      </motion.span>
      <motion.span
        layoutId={`${morphId}-filename`}
        layout="position"
        transition={transitions.morph}
        className="truncate"
      >
        {filename}
      </motion.span>
    </>
  )
}

export function AttachmentChip({
  url,
  alt,
  filename,
  kind,
  morphId,
  onBroken
}: {
  url: string
  alt: string
  filename: string
  kind: "image" | "file"
  morphId: string
  onBroken?: () => void
}) {
  const [broken, setBroken] = useState(false)

  if (kind !== "image" || broken) {
    return (
      <span className={CHIP}>
        <ChipBody filename={filename} kind={kind} morphId={morphId} />
        <AttachmentDownload url={url} filename={filename} morphId={morphId} />
      </span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={HOVER_DELAY_MS}
        render={<span className={CHIP} />}
        contentEditable={false}
      >
        <ChipBody filename={filename} kind={kind} morphId={morphId} />
        <AttachmentDownload url={url} filename={filename} morphId={morphId} />
      </PopoverTrigger>
      <PopoverContent className="w-auto max-w-sm p-1.5" align="start">
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block max-h-72 max-w-full rounded-md object-contain"
          onError={() => {
            setBroken(true)
            onBroken?.()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

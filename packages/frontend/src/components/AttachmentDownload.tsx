import { motion } from "motion/react"
import { Download } from "lucide-react"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"

export function AttachmentDownload({
  url,
  filename,
  morphId
}: {
  url: string
  filename: string
  morphId: string
}) {
  return (
    <motion.a
      layoutId={`${morphId}-download`}
      layout="position"
      transition={transitions.morph}
      href={url}
      download={filename}
      aria-label={m.editor_attachment_download()}
      title={m.editor_attachment_download()}
      onMouseDown={(event) => event.stopPropagation()}
      className="shrink-0 rounded text-muted-foreground transition-colors duration-100 hover:text-foreground active:[&>svg]:scale-[0.97] [&>svg]:transition-transform [&>svg]:duration-100"
    >
      <Download strokeWidth={1.75} className="size-3" aria-hidden="true" />
    </motion.a>
  )
}

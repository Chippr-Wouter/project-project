import { useEffect, useState, type ReactNode } from "react"
import { motion } from "motion/react"
import {
  attachmentFileFormat,
  type AttachmentFileFormat
} from "@projectproject/shared"
import { AttachmentDownload } from "@/components/AttachmentDownload"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

export const ATTACHMENT_TILE_MIN_WIDTH = 148
export const ATTACHMENT_TILE_PREVIEW_HEIGHT = 176
// The filename row: text-xs on a 16px line box, py-2, over a 1px top border.
export const ATTACHMENT_TILE_FOOTER_HEIGHT = 33

const PREVIEW_BOX =
  "flex h-[176px] w-full min-w-[148px] items-center justify-center"

const GLYPH = {
  width: 48,
  height: 56,
  viewBox: "0 0 48 56",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round"
} as const

const documentArt = (
  <>
    <path d="M6 1h22l14 14v40H6z" />
    <path d="M28 1v14h14" strokeOpacity="0.45" />
    <path
      d="M13 26h22M13 34h22M13 42h14"
      strokeOpacity="0.45"
      strokeWidth="1"
    />
  </>
)

const FORMATS: Record<
  AttachmentFileFormat,
  { readonly label: () => string; readonly art: ReactNode }
> = {
  pdf: { label: m.editor_attachment_format_pdf, art: documentArt },
  generic: { label: m.editor_attachment_format_generic, art: documentArt },
  zip: {
    label: m.editor_attachment_format_zip,
    art: (
      <>
        <rect x="1" y="1" width="46" height="54" rx="4" />
        <line x1="24" y1="1" x2="24" y2="55" />
        <path
          d="M19 9h10M19 15h10M19 21h10M19 27h10"
          strokeOpacity="0.45"
          strokeWidth="1"
        />
        <rect x="20.5" y="33" width="7" height="11" rx="2.5" />
      </>
    )
  },
  tar: {
    label: m.editor_attachment_format_tar,
    art: (
      <>
        <rect x="1" y="1" width="46" height="54" rx="4" />
        <path
          d="M1 15h46M1 24h46M1 33h46M1 42h46"
          strokeOpacity="0.45"
          strokeWidth="1"
        />
      </>
    )
  },
  gzip: {
    label: m.editor_attachment_format_gzip,
    art: (
      <>
        <rect x="1" y="1" width="46" height="54" rx="4" />
        <path d="M1 14h46M1 42h46" strokeOpacity="0.45" strokeWidth="1" />
        <path d="M14 22l10 8 10-8" />
        <path d="M14 29l10 8 10-8" strokeOpacity="0.45" />
      </>
    )
  }
}

function FormatPreview({ format }: { format: AttachmentFileFormat }) {
  return (
    <span className={cn(PREVIEW_BOX, "flex-col gap-3 text-muted-foreground")}>
      <svg {...GLYPH} aria-hidden="true">
        {FORMATS[format].art}
      </svg>
      <span className="text-[11px] font-medium">{FORMATS[format].label()}</span>
    </span>
  )
}

const SPREAD_LAYOUT = [
  { slot: "back", offset: -10, rotate: -6 },
  { slot: "middle", offset: 6, rotate: 4 },
  { slot: "front", offset: 0, rotate: 0 }
] as const

type SpreadState = ReadonlyArray<string> | "loading" | "failed"

function PdfSpread({ url, alt }: { url: string; alt: string }) {
  const [state, setState] = useState<SpreadState>("loading")

  useEffect(() => {
    let cancelled = false
    setState("loading")
    void import("./pdfSpread")
      .then(({ renderPdfSpread }) => renderPdfSpread(url))
      .then(
        (pages) => {
          if (!cancelled) setState(pages.length === 0 ? "failed" : pages)
        },
        () => {
          if (!cancelled) setState("failed")
        }
      )
    return () => {
      cancelled = true
    }
  }, [url])

  if (state === "failed") return <FormatPreview format="pdf" />

  if (state === "loading") {
    return (
      <span className={PREVIEW_BOX}>
        <span className="h-[152px] w-[108px] animate-pulse rounded-[3px] border border-border bg-muted/50" />
      </span>
    )
  }

  const layout = SPREAD_LAYOUT.slice(SPREAD_LAYOUT.length - state.length)

  return (
    <span className={cn(PREVIEW_BOX, "relative")}>
      {state.map((page, index) => {
        const { slot, offset, rotate } = layout[index]
        return (
          <span
            key={slot}
            className="absolute top-1/2 left-1/2 max-h-[152px] w-[104px] overflow-hidden rounded-[3px] border border-black/12 bg-white"
            style={{
              transform: `translate(-50%, -50%) translateX(${offset}px) rotate(${rotate}deg)`,
              zIndex: state.length - index
            }}
          >
            <img
              src={page}
              alt={index === 0 ? alt : ""}
              aria-hidden={index === 0 ? undefined : "true"}
              className="block h-auto w-full"
            />
          </span>
        )
      })}
    </span>
  )
}

export function AttachmentTile({
  url,
  alt,
  filename,
  morphId
}: {
  url: string
  alt: string
  filename: string
  morphId: string
}) {
  const format = attachmentFileFormat(filename)
  return (
    <span className="block w-fit max-w-full rounded-xl border border-border bg-card">
      {format === "pdf" ? (
        <PdfSpread url={url} alt={alt} />
      ) : (
        <FormatPreview format={format} />
      )}
      <span className="flex w-full items-center gap-3 border-t border-border px-3 py-2 text-xs">
        <motion.span
          layoutId={`${morphId}-filename`}
          layout="position"
          transition={transitions.morph}
          className="min-w-0 flex-1 truncate"
          title={filename}
        >
          {filename}
        </motion.span>
        <AttachmentDownload url={url} filename={filename} morphId={morphId} />
      </span>
    </span>
  )
}

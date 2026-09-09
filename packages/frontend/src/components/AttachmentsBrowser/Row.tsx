import { Link, useNavigate } from "@tanstack/react-router"
import { Download, FileText } from "lucide-react"
import {
  attachmentDownloadUrl,
  isRasterImageContentType
} from "@projectproject/shared"
import type { AttachmentRow, AttachmentTicketRef } from "@projectproject/shared"
import { formatAttachmentMarkdown } from "@projectproject/shared"
import { CopyButton } from "@/components/ui/copy-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from "@/components/ui/select"
import { formatBytes } from "@/lib/formatBytes"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"
import { hasThumbnail, isDeletable, STATUS_LABEL } from "./selection"

const refKey = (ref: AttachmentTicketRef) =>
  `${ref.projectSlug}/${ref.ticketId}`

export function Row({
  orgSlug,
  row,
  selected,
  onToggle,
  children
}: {
  orgSlug: string
  row: AttachmentRow
  selected: boolean
  onToggle: (id: string) => void
  children?: React.ReactNode
}) {
  const locale = getLocale()
  const navigate = useNavigate()
  const only = row.tickets.length === 1 ? row.tickets[0] : undefined

  const openTicket = (ref: AttachmentTicketRef) =>
    navigate({
      to: "/orgs/$orgSlug/projects/$slug/tickets/$id",
      params: { orgSlug, slug: ref.projectSlug, id: ref.ticketId }
    })

  return (
    <tr
      className={cn(
        "group/reveal border-b border-border transition-colors hover:bg-accent/60",
        only && "cursor-pointer"
      )}
      onClick={only ? () => void openTicket(only) : undefined}
    >
      <td className="w-6 px-2 py-2 align-middle">
        {isDeletable(row) ? (
          <input
            type="checkbox"
            className="size-4 rounded border border-border align-middle"
            checked={selected}
            onChange={() => onToggle(row.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={m.attachments_select_row({ filename: row.filename })}
          />
        ) : null}
      </td>

      <td className="w-full max-w-0 px-2 py-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Thumbnail row={row} />
          <span className="truncate font-mono text-[13px]">{row.filename}</span>
        </div>
      </td>

      <td className="max-w-[180px] truncate px-2 py-2 text-sm text-muted-foreground">
        {row.projectSlug}
      </td>

      <td className="px-2 py-2">
        <TicketCell orgSlug={orgSlug} row={row} onOpen={openTicket} />
      </td>

      <td className="px-2 py-2 text-right text-sm tabular-nums whitespace-nowrap text-muted-foreground">
        {formatBytes(row.byteSize, locale)}
      </td>

      <td
        className={cn(
          "px-2 py-2 text-sm whitespace-nowrap",
          row.status === "orphaned"
            ? "text-foreground"
            : "text-muted-foreground"
        )}
      >
        {STATUS_LABEL[row.status]()}
      </td>

      <td className="px-2 py-2 text-sm whitespace-nowrap text-muted-foreground">
        {row.createdAt.toLocaleDateString(locale)}
      </td>

      <td
        className="px-2 py-2 text-right whitespace-nowrap"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-end gap-0.5">
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/reveal:opacity-100 focus-within:opacity-100">
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <CopyButton
                  nativeTitle={false}
                  value={formatAttachmentMarkdown({
                    kind: isRasterImageContentType(row.contentType)
                      ? "image"
                      : "file",
                    alt: row.filename,
                    url: row.url
                  })}
                  copyLabel={m.attachments_copy_markdown()}
                  copiedLabel={m.attachments_copied()}
                />
              </TooltipTrigger>
              <TooltipContent>{m.attachments_copy_markdown()}</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <a
                    href={attachmentDownloadUrl(orgSlug, row.id)}
                    download={row.filename}
                    aria-label={m.attachments_download()}
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors transition-transform duration-100 hover:bg-muted hover:text-foreground active:scale-[0.97]"
                  />
                }
              >
                <Download className="size-3.5" strokeWidth={1.75} />
              </TooltipTrigger>
              <TooltipContent>{m.attachments_download()}</TooltipContent>
            </Tooltip>
          </span>
          {children}
        </div>
      </td>
    </tr>
  )
}

function TicketCell({
  orgSlug,
  row,
  onOpen
}: {
  orgSlug: string
  row: AttachmentRow
  onOpen: (ref: AttachmentTicketRef) => void
}) {
  if (row.ticketId === null) {
    return (
      <Link
        to="/orgs/$orgSlug/projects/$slug/settings/general"
        params={{ orgSlug, slug: row.projectSlug }}
        className="text-[13px] transition-colors hover:text-foreground"
      >
        {m.attachments_project_image()}
      </Link>
    )
  }
  if (row.tickets.length === 0) {
    return (
      <span
        className="font-mono text-[13px] text-muted-foreground/70"
        title={m.attachments_ticket_unreferenced()}
      >
        {row.ticketId}
      </span>
    )
  }

  const first = row.tickets[0]!

  if (row.tickets.length === 1) {
    return (
      <Link
        to="/orgs/$orgSlug/projects/$slug/tickets/$id"
        params={{ orgSlug, slug: first.projectSlug, id: first.ticketId }}
        onClick={(event) => event.stopPropagation()}
        className="font-mono text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {first.ticketId}
      </Link>
    )
  }

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <Select
        value=""
        onValueChange={(value) => {
          const ref = row.tickets.find((entry) => refKey(entry) === value)
          if (ref) onOpen(ref)
        }}
      >
        <SelectTrigger
          className="h-7 w-auto gap-1.5 px-2 font-mono text-[13px]"
          placeholder={m.attachments_ticket_count({
            count: row.tickets.length
          })}
          selectedLabel={m.attachments_ticket_count({
            count: row.tickets.length
          })}
          aria-label={m.attachments_ticket_pick()}
        />
        <SelectContent>
          {row.tickets.map((ref, index) => (
            <SelectItem key={refKey(ref)} index={index} value={refKey(ref)}>
              {ref.ticketId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Thumbnail({ row }: { row: AttachmentRow }) {
  if (!hasThumbnail(row)) {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] border border-border text-muted-foreground">
        <FileText className="size-4" strokeWidth={1.75} />
      </span>
    )
  }
  return (
    <img
      src={row.url}
      alt={m.attachments_thumbnail_alt({ filename: row.filename })}
      loading="lazy"
      className="size-8 shrink-0 rounded-[7px] border border-border object-cover"
    />
  )
}

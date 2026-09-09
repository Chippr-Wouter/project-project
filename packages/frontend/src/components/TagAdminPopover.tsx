import * as Schema from "effect/Schema"
import { Trash2 } from "lucide-react"
import { useState, type ReactElement } from "react"
import { motion } from "motion/react"
import { ColorPicker } from "@/components/ColorPicker"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { ConfirmButton, useConfirmButton } from "@/components/ui/confirm-button"
import { Button } from "@/components/ui/button"
import { m } from "@/paraglide/messages"
import { TagColor, TagName, type Tag } from "@projectproject/shared"

const VALID = /^[a-z0-9][a-z0-9 -]{0,30}$/
const makeTagName = Schema.decodeUnknownSync(TagName)
const makeTagColor = Schema.decodeUnknownSync(TagColor)

type Props = {
  tag: Tag
  usageCount: number
  onPatch: (patch: { nextName?: TagName; color?: Tag["color"] }) => void
  onDelete: () => Promise<void> | void
  onOpenChange?: (open: boolean) => void
  children: ReactElement<Record<string, unknown>>
}

export function TagAdminPopover({
  tag,
  usageCount,
  onPatch,
  onDelete,
  onOpenChange,
  children
}: Props) {
  const [open, setOpen] = useState(false)
  const changeOpen = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger render={children} />
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 p-2"
        initialFocus={true}
      >
        <ConfirmButton.Root className="w-full">
          <Body
            tag={tag}
            usageCount={usageCount}
            onPatch={onPatch}
            onConfirmDelete={async () => {
              await onDelete()
              changeOpen(false)
            }}
            onDismiss={() => changeOpen(false)}
          />
        </ConfirmButton.Root>
      </PopoverContent>
    </Popover>
  )
}

function Body({
  tag,
  usageCount,
  onPatch,
  onConfirmDelete,
  onDismiss
}: {
  tag: Tag
  usageCount: number
  onPatch: (patch: { nextName?: TagName; color?: Tag["color"] }) => void
  onConfirmDelete: () => Promise<void>
  onDismiss: () => void
}) {
  const { state } = useConfirmButton()
  return (
    <div className="w-full">
      <motion.div
        key={state}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitions.fade}
      >
        {state === "idle" ? (
          <Editor
            tag={tag}
            usageCount={usageCount}
            onPatch={onPatch}
            onDismiss={onDismiss}
          />
        ) : (
          <Confirm
            tag={tag}
            usageCount={usageCount}
            onConfirm={onConfirmDelete}
          />
        )}
      </motion.div>
    </div>
  )
}

function Editor({
  tag,
  usageCount,
  onPatch,
  onDismiss
}: {
  tag: Tag
  usageCount: number
  onPatch: (patch: { nextName?: TagName; color?: Tag["color"] }) => void
  onDismiss: () => void
}) {
  const { open: openConfirm } = useConfirmButton()
  const [draftName, setDraftName] = useState<string>(tag.name)

  const trimmed = draftName.trim()
  const invalid = trimmed.length > 0 && !VALID.test(trimmed)

  const commit = () => {
    if (trimmed === tag.name || invalid || trimmed.length === 0) return
    onPatch({ nextName: makeTagName(trimmed) })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <ColorPicker
          value={tag.color}
          onChange={(hex) => onPatch({ color: makeTagColor(hex) })}
          ariaLabel={m.tags_color_aria_label({ name: tag.name })}
        />
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value.toLowerCase())}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commit()
            }
            if (e.key === "Escape") {
              setDraftName(tag.name)
              onDismiss()
            }
          }}
          aria-label={m.tags_name_aria_label()}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "tag-rename-error" : undefined}
          className={cn(
            "h-7 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs outline-none transition-colors",
            invalid
              ? "border-destructive/60 focus-visible:border-destructive"
              : "border-border focus-visible:border-foreground/40"
          )}
        />
        <button
          type="button"
          onClick={openConfirm}
          aria-label={m.tags_delete_button()}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-destructive/10 hover:text-destructive active:scale-[0.97]"
        >
          <Trash2 className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
      {invalid ? (
        <p
          id="tag-rename-error"
          className="px-0.5 text-[11px] leading-tight text-destructive"
        >
          {m.tags_name_validation_hint()}
        </p>
      ) : (
        <p className="px-0.5 text-[11px] text-muted-foreground">
          {usageCount === 1
            ? m.tags_usage_one()
            : m.tags_usage_many({ count: usageCount })}
        </p>
      )}
    </div>
  )
}

function Confirm({
  tag,
  usageCount,
  onConfirm
}: {
  tag: Tag
  usageCount: number
  onConfirm: () => Promise<void>
}) {
  const { close, busy, setBusy } = useConfirmButton()
  const run = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } catch {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <p>
        {usageCount === 1
          ? m.tags_delete_confirm_one({ name: tag.name })
          : m.tags_delete_confirm_many({
              name: tag.name,
              count: usageCount
            })}
      </p>
      <div className="flex gap-1">
        <Button
          size="sm"
          onClick={() => void run()}
          disabled={busy}
          className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {busy ? m.tags_delete_in_progress() : m.tags_delete_button()}
        </Button>
        <Button size="sm" variant="ghost" onClick={close} disabled={busy}>
          {m.common_cancel_button()}
        </Button>
      </div>
    </div>
  )
}

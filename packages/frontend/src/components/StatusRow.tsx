import { useAtomSet } from "@effect/atom-react"
import { Reorder, useDragControls, type DragControls } from "motion/react"
import { GripVertical, Lock } from "lucide-react"
import { useEffect, useState } from "react"
import {
  isReservedStatusSlug,
  type ProjectStatus,
  type StatusIconName
} from "@projectproject/shared"
import { projectKey, updateStatusAtom } from "@/atoms/projectStatuses"
import { ColorPicker } from "@/components/ColorPicker"
import { Input } from "@/components/ui/input"
import { StatusDeleteConfirm } from "@/components/StatusDeleteConfirm"
import { StatusIconPicker } from "@/components/StatusIconPicker"
import { statusLabelFor, statusMetaFor } from "@/lib/ticket-meta"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

type Props = {
  status: ProjectStatus
  statuses: ReadonlyArray<ProjectStatus>
  orgSlug: string
  slug: string
  onDragStart: () => void
  onDragEnd: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

export function StatusRow({
  status,
  statuses,
  orgSlug,
  slug,
  onDragStart,
  onDragEnd,
  onMoveUp,
  onMoveDown
}: Props) {
  const baseline = isReservedStatusSlug(status.slug)
  const key = projectKey(orgSlug, slug)
  const update = useAtomSet(updateStatusAtom(key))
  const controls = useDragControls()
  const [draftLabel, setDraftLabel] = useState<string>(status.label)
  const [isDragging, setIsDragging] = useState(false)
  const [iconMenuOpen, setIconMenuOpen] = useState(false)
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const menuOpen = iconMenuOpen || colorMenuOpen

  useEffect(() => {
    setDraftLabel(status.label)
  }, [status.label])

  const commitLabel = () => {
    if (baseline || draftLabel === status.label) return
    const trimmed = draftLabel.trim()
    if (trimmed.length === 0) {
      setDraftLabel(status.label)
      return
    }
    update({
      statusSlug: status.slug,
      patch: { label: trimmed as ProjectStatus["label"] }
    })
  }

  const baselineMeta = baseline ? statusMetaFor(status.slug, statuses) : null
  const BaselineIcon = baselineMeta?.icon
  const displayLabel = baseline
    ? statusLabelFor(status.slug, statuses)
    : status.label

  return (
    <Reorder.Item
      value={status}
      dragListener={false}
      dragControls={controls}
      onDragStart={() => {
        setIsDragging(true)
        onDragStart()
      }}
      onDragEnd={() => {
        setIsDragging(false)
        onDragEnd()
      }}
      className={cn(
        "list-none rounded-md",
        isDragging && "z-10 shadow-md",
        menuOpen && "z-20"
      )}
      animate={{ scale: isDragging ? 1.01 : 1 }}
      transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
    >
      <div
        className={cn(
          "flex items-center gap-2 rounded-md px-1 py-1 transition-colors duration-150",
          isDragging ? "bg-card" : "hover:bg-accent/40"
        )}
      >
        <DragHandle
          controls={controls}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          ariaLabel={m.tickets_status_drag_handle_aria({ label: displayLabel })}
        />

        {baseline && baselineMeta && BaselineIcon ? (
          <>
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center"
              aria-hidden
            >
              <BaselineIcon
                className={cn("h-4 w-4", baselineMeta.className)}
                style={
                  baselineMeta.color ? { color: baselineMeta.color } : undefined
                }
                strokeWidth={1.75}
              />
            </div>
            <span className="flex-1 truncate px-1 text-sm text-muted-foreground">
              {displayLabel}
            </span>
            <div
              role="img"
              aria-label={m.tickets_status_baseline_locked_aria()}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground/40"
            >
              <Lock className="h-3.5 w-3.5" />
            </div>
          </>
        ) : (
          <>
            <StatusIconPicker
              value={status.icon}
              color={status.color}
              onOpenChange={setIconMenuOpen}
              onChange={(icon) =>
                update({
                  statusSlug: status.slug,
                  patch: { icon: icon as StatusIconName }
                })
              }
            />
            <div className="flex h-8 w-8 shrink-0 items-center justify-center">
              <ColorPicker
                value={status.color}
                onOpenChange={setColorMenuOpen}
                onChange={(color) =>
                  update({
                    statusSlug: status.slug,
                    patch: { color: color as ProjectStatus["color"] }
                  })
                }
              />
            </div>
            <Input
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                if (e.key === "Escape") {
                  setDraftLabel(status.label)
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              className="h-8 flex-1 rounded-md"
            />
            <StatusDeleteConfirm
              status={status}
              statuses={statuses}
              orgSlug={orgSlug}
              slug={slug}
            />
          </>
        )}
      </div>
    </Reorder.Item>
  )
}

function DragHandle({
  controls,
  onMoveUp,
  onMoveDown,
  ariaLabel
}: {
  controls: DragControls
  onMoveUp?: () => void
  onMoveDown?: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onPointerDown={(e) => controls.start(e)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" && onMoveUp) {
          e.preventDefault()
          onMoveUp()
        }
        if (e.key === "ArrowDown" && onMoveDown) {
          e.preventDefault()
          onMoveDown()
        }
      }}
      className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 transition-colors duration-100 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" />
    </button>
  )
}

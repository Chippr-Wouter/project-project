import type { AttachmentSort, AttachmentStatus } from "@projectproject/shared"
import { SEGMENTED_ITEM_CLASS, SegmentedTabs } from "@/components/SegmentedTabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger
} from "@/components/ui/select"
import { m } from "@/paraglide/messages"

export type StatusFilter = AttachmentStatus | "all"

const STATUS_ITEMS = [
  { key: "all" as const, label: m.attachments_filter_status_all() },
  { key: "live" as const, label: m.attachments_status_live() },
  { key: "orphaned" as const, label: m.attachments_status_orphaned() },
  { key: "pending" as const, label: m.attachments_status_pending() }
]

const SORT_LABEL: Record<AttachmentSort, () => string> = {
  created_desc: m.attachments_sort_created_desc,
  created_asc: m.attachments_sort_created_asc,
  size_desc: m.attachments_sort_size_desc,
  size_asc: m.attachments_sort_size_asc
}

const SORTS = [
  "created_desc",
  "created_asc",
  "size_desc",
  "size_asc"
] as const satisfies ReadonlyArray<AttachmentSort>

const ALL_PROJECTS = "__all__"

export function Toolbar({
  status,
  onStatusChange,
  projectSlug,
  projects,
  onProjectChange,
  sort,
  onSortChange
}: {
  status: StatusFilter
  onStatusChange: (status: StatusFilter) => void
  projectSlug: string | null
  projects: ReadonlyArray<{ slug: string; name: string }>
  onProjectChange: (slug: string | null) => void
  sort: AttachmentSort
  onSortChange: (sort: AttachmentSort) => void
}) {
  const selectedProject =
    projects.find((project) => project.slug === projectSlug) ?? null

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedTabs
        items={STATUS_ITEMS}
        isActive={(key) => key === status}
        renderItem={(item, content, { active }) => (
          <button
            type="button"
            onClick={() => onStatusChange(item.key)}
            aria-pressed={active}
            className={SEGMENTED_ITEM_CLASS(active)}
          >
            {content}
          </button>
        )}
      />

      <Select
        value={projectSlug ?? ALL_PROJECTS}
        onValueChange={(value) =>
          onProjectChange(value === ALL_PROJECTS ? null : value)
        }
      >
        <SelectTrigger
          placeholder={m.attachments_filter_project_all()}
          selectedLabel={
            selectedProject?.name ?? m.attachments_filter_project_all()
          }
          aria-label={m.attachments_filter_project_label()}
        />
        <SelectContent>
          <SelectItem index={0} value={ALL_PROJECTS}>
            {m.attachments_filter_project_all()}
          </SelectItem>
          {projects.map((project, index) => (
            <SelectItem
              key={project.slug}
              index={index + 1}
              value={project.slug}
            >
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={sort}
        onValueChange={(value) => {
          const next = SORTS.find((key) => key === value)
          if (next) onSortChange(next)
        }}
      >
        <SelectTrigger
          placeholder={m.attachments_sort_label()}
          selectedLabel={SORT_LABEL[sort]()}
          aria-label={m.attachments_sort_label()}
        />
        <SelectContent>
          {SORTS.map((key, index) => (
            <SelectItem key={key} index={index} value={key}>
              {SORT_LABEL[key]()}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

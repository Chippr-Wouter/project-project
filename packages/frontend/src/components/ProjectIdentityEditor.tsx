import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Schema from "effect/Schema"
import { ProjectColor, ProjectIcon } from "@projectproject/shared"
import { projectKey, updateProjectAtom } from "@/atoms/projects"
import { ColorPicker } from "@/components/ColorPicker"
import { ProjectTile } from "@/components/ProjectTile"
import {
  EmojiPicker,
  EmojiPickerContent,
  EmojiPickerSearch
} from "@/components/ui/emoji-picker"
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

const makeProjectIcon = Schema.decodeUnknownSync(ProjectIcon)
const makeProjectColor = Schema.decodeUnknownSync(ProjectColor)

type Props = {
  orgSlug: string
  slug: string
  icon: string
  color: string
  canEdit: boolean
  size?: "header" | "settings"
}

export function ProjectIdentityEditor({
  orgSlug,
  slug,
  icon,
  color,
  canEdit,
  size = "header"
}: Props) {
  const key = projectKey(orgSlug, slug)
  const update = useAtomSet(updateProjectAtom(key))
  const updateState = useAtomValue(updateProjectAtom(key))
  const waiting = updateState.waiting
  const error = Result.isFailure(updateState)
  const tile = (
    <ProjectTile
      icon={icon}
      color={color}
      size={size === "header" ? "md" : "lg"}
      seed={slug}
      waiting={waiting}
    />
  )

  if (!canEdit) {
    return (
      <div className={cn("w-fit shrink-0", size === "header" && "-mt-1")}>
        {tile}
      </div>
    )
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={m.project_identity_aria_label()}
            className={cn(
              "w-fit shrink-0 rounded-2xl corner-squircle outline-none transition-transform duration-100 active:scale-[0.97]",
              size === "header" && "-mt-1"
            )}
          >
            {tile}
          </button>
        }
      />
      <PopoverContent
        align="start"
        sideOffset={8}
        keepMounted
        className="flex w-fit items-start gap-3 p-3"
      >
        <div className="relative z-50 mt-1 ml-1 shrink-0">
          <ColorPicker
            value={color}
            onChange={(next) => update({ color: makeProjectColor(next) })}
            ariaLabel={m.color_picker_aria_label()}
          />
        </div>
        <div className="flex flex-col">
          <EmojiPicker
            className="h-[320px]"
            onEmojiSelect={({ emoji }) =>
              update({ icon: makeProjectIcon(emoji) })
            }
          >
            <EmojiPickerSearch
              placeholder={m.project_identity_emoji_search_placeholder()}
              aria-label={m.project_identity_emoji_aria_label()}
            />
            <EmojiPickerContent />
          </EmojiPicker>
          {error ? (
            <div role="alert" className="mt-2 text-xs text-destructive">
              {m.project_identity_error()}
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}

import { useEffect, type JSX } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $insertNodes, COMMAND_PRIORITY_LOW, PASTE_COMMAND } from "lexical"
import { figmaSrc, parseFigmaUrl } from "@projectproject/shared"
import { $createFigmaNode } from "./FigmaNode"
import { figmaSlugLabel } from "./FigmaChip"

export function FigmaPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent)) return false
          if (event.clipboardData?.files.length) return false

          const text = event.clipboardData?.getData("text/plain")?.trim()
          if (!text || /\s/.test(text)) return false

          const ref = parseFigmaUrl(text)
          if (ref === null) return false

          const slug = figmaSlugLabel(ref.slug)
          event.preventDefault()
          editor.update(() => {
            $insertNodes([
              $createFigmaNode({
                url: figmaSrc(text),
                label: slug.length > 0 ? slug : text,
                ref,
                density: "compact"
              })
            ])
          })
          return true
        },
        COMMAND_PRIORITY_LOW
      ),
    [editor]
  )

  return null
}

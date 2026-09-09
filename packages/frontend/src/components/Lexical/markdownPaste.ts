import { $isCodeNode } from "@lexical/code"
import { $insertGeneratedNodes } from "@lexical/clipboard"
import { $convertFromMarkdownString, type Transformer } from "@lexical/markdown"
import {
  $addUpdateTag,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
  PASTE_COMMAND,
  PASTE_TAG,
  type LexicalEditor
} from "lexical"

export function registerMarkdownPaste(
  editor: LexicalEditor,
  transformers: Transformer[]
) {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!(event instanceof ClipboardEvent)) return false
      const data = event.clipboardData
      if (!data) return false
      const text = data.getData("text/plain")
      if (
        !text ||
        data.files.length > 0 ||
        data.getData("text/html") ||
        data.getData("application/x-lexical-editor")
      )
        return false

      const selection = $getSelection()
      if (!$isRangeSelection(selection)) return false
      const anchor = selection.anchor.getNode()
      if ([anchor, ...anchor.getParents()].some($isCodeNode)) return false

      const insertion = selection.clone()
      const container = $createParagraphNode()
      $getRoot().append(container)
      try {
        $convertFromMarkdownString(text, transformers, container)
      } finally {
        $setSelection(insertion)
        container.remove()
      }
      $insertGeneratedNodes(editor, container.getChildren(), insertion)
      $addUpdateTag(PASTE_TAG)
      event.preventDefault()
      return true
    },
    COMMAND_PRIORITY_NORMAL
  )
}

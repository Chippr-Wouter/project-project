import {
  $convertFromMarkdownString,
  $convertToMarkdownString
} from "@lexical/markdown"
import { HorizontalRuleNode } from "@lexical/extension"
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  createEditor
} from "lexical"
import { describe, expect, it } from "vite-plus/test"
import { HORIZONTAL_RULE } from "./horizontalRuleTransformer"

function importMarkdown(markdown: string) {
  const editor = createEditor({
    namespace: "horizontal-rule-test",
    nodes: [HorizontalRuleNode],
    onError: (error) => {
      throw error
    }
  })

  let selection: unknown = null
  let exported = ""

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, [HORIZONTAL_RULE])
      const root = $getRoot()
      const last = root.getLastChild()
      if (!last || last.getType() !== "paragraph") {
        root.append($createParagraphNode())
      }
      selection = $getSelection()
      exported = $convertToMarkdownString([HORIZONTAL_RULE])
    },
    { discrete: true }
  )

  return { exported, selection }
}

describe("HORIZONTAL_RULE", () => {
  it("does not create an active selection while importing markdown", () => {
    const result = importMarkdown("before\n\n---\n\nafter")

    expect(result.exported).toBe("before\n\n---\n\nafter")
    expect(result.selection).toBeNull()
  })
})

import { TableNode, TableRowNode, TableCellNode } from "@lexical/table"
import { CodeNode, $createCodeNode } from "@lexical/code"
import { createEmptyHistoryState, registerHistory } from "@lexical/history"
import {
  $convertFromMarkdownString,
  $convertToMarkdownString
} from "@lexical/markdown"
import { HeadingNode, QuoteNode, registerRichText } from "@lexical/rich-text"
import { ListNode, ListItemNode } from "@lexical/list"
import { LinkNode } from "@lexical/link"
import { HorizontalRuleNode } from "@lexical/extension"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  createEditor,
  PASTE_COMMAND,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
  UNDO_COMMAND,
  type LexicalEditor
} from "lexical"
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi
} from "vite-plus/test"
import { MARKDOWN_TRANSFORMERS } from "../LexicalEditor"
import { MentionNode } from "./MentionNode"
import { AttachmentNode } from "./AttachmentNode"
import { ATTACHMENT_TRANSFORMER } from "./attachmentTransformer"
import { registerMarkdownPaste } from "./markdownPaste"

beforeAll(() => {
  vi.stubGlobal("ClipboardEvent", class ClipboardEvent extends Event {})
  vi.stubGlobal("DragEvent", class DragEvent extends Event {})
})
afterAll(() => vi.unstubAllGlobals())

const transformers = [ATTACHMENT_TRANSFORMER, ...MARKDOWN_TRANSFORMERS]

function pasteEvent(text: string, html = "", files: File[] = []) {
  const event = new ClipboardEvent("paste", { cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    value: {
      files,
      types: ["text/plain", ...(html ? ["text/html"] : [])],
      getData: (type: string) =>
        type === "text/plain" ? text : type === "text/html" ? html : ""
    }
  })
  return event
}

function createPasteEditor(text = "", code = false) {
  const editor = createEditor({
    nodes: [
      TableNode,
      TableRowNode,
      TableCellNode,
      CodeNode,
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      HorizontalRuleNode,
      MentionNode,
      AttachmentNode
    ],
    onError: (error) => {
      throw error
    }
  })
  onTestFinished(registerRichText(editor))
  onTestFinished(registerMarkdownPaste(editor, transformers))
  onTestFinished(registerHistory(editor, createEmptyHistoryState(), 1000))
  editor.update(
    () => {
      const block = code ? $createCodeNode() : $createParagraphNode()
      $getRoot()
        .append(block.append($createTextNode(text)))
        .selectEnd()
    },
    { discrete: true }
  )
  return editor
}

function paste(editor: LexicalEditor, event: ClipboardEvent) {
  editor.update(
    () => {
      editor.dispatchCommand(PASTE_COMMAND, event)
    },
    { discrete: true }
  )
}

function markdown(editor: LexicalEditor) {
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(transformers))
}

describe("Markdown paste", () => {
  it("formats bold and replaces only the selection", () => {
    const editor = createPasteEditor("before replace after")
    editor.update(
      () => {
        $getRoot().getAllTextNodes()[0]?.select(7, 14)
      },
      { discrete: true }
    )
    paste(editor, pasteEvent("**bold**"))
    expect(markdown(editor)).toBe("before **bold** after")
  })

  it.each([
    "| Name | Value |\n| --- | ---: |\n| **One** | 2 |",
    "intro\n# Heading\nend",
    "hello\nworld",
    "- one\n  continuation\n- two",
    "> quote\ncontinuation",
    "```ts\nconst value = 1\n```",
    "**bold**\n\n![shot](/api/attachments/acme/01JBX7Q2K9ZWCVE8MTQ4RXPGHN)"
  ])("matches loaded Markdown structure for %s", (source) => {
    const pasted = createPasteEditor()
    paste(pasted, pasteEvent(source))
    const loaded = createPasteEditor()
    loaded.update(
      () => {
        $convertFromMarkdownString(source, transformers)
      },
      { discrete: true }
    )
    expect(pasted.getEditorState().toJSON()).toEqual(
      loaded.getEditorState().toJSON()
    )
  })

  it("continues typing with the pasted text's formatting", () => {
    const editor = createPasteEditor("start ")
    paste(editor, pasteEvent("**bold**"))
    editor.update(
      () => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection))
          throw new Error("Expected range selection")
        selection.insertText("X")
      },
      { discrete: true }
    )
    expect(markdown(editor)).toBe("start **boldX**")
  })

  it("passes parsed nodes through Lexical's clipboard insertion command", () => {
    const editor = createPasteEditor()
    const inserted = vi.fn(() => false)
    onTestFinished(
      editor.registerCommand(
        SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
        inserted,
        COMMAND_PRIORITY_HIGH
      )
    )
    paste(editor, pasteEvent("**bold**"))
    expect(inserted).toHaveBeenCalledOnce()
  })

  it("uses HTML formatting when T3 supplies HTML alongside Markdown", () => {
    const editor = createPasteEditor()
    paste(
      editor,
      pasteEvent(
        "**bold**",
        '<meta charset="utf-8"><p><strong>bold</strong></p>'
      )
    )
    expect(markdown(editor)).toBe("**bold**")
  })

  it("keeps Markdown literal inside code blocks", () => {
    const editor = createPasteEditor("", true)
    paste(editor, pasteEvent("**bold**"))
    expect(
      editor.getEditorState().read(() => $getRoot().getTextContent())
    ).toBe("**bold**")
    expect(
      editor.getEditorState().read(() =>
        $getRoot()
          .getAllTextNodes()
          .some((node) => node.hasFormat("bold"))
      )
    ).toBe(false)
  })

  it("leaves files to the attachment handler", () => {
    const editor = createPasteEditor()
    const attachmentHandler = vi.fn(() => true)
    onTestFinished(
      editor.registerCommand(
        PASTE_COMMAND,
        attachmentHandler,
        COMMAND_PRIORITY_LOW
      )
    )
    paste(editor, pasteEvent("**bold**", "", [new File([], "image.png")]))
    expect(attachmentHandler).toHaveBeenCalledOnce()
    expect(markdown(editor)).toBe("")
  })

  it("undoes the paste without removing preceding content", async () => {
    const editor = createPasteEditor("before ")
    paste(editor, pasteEvent("**bold**"))
    editor.dispatchCommand(UNDO_COMMAND, undefined)
    await Promise.resolve()
    expect(markdown(editor)).toBe("before ")
  })
})

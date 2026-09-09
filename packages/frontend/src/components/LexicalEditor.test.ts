import { TableNode, TableRowNode, TableCellNode } from "@lexical/table"
import {
  $convertFromMarkdownString,
  $convertToMarkdownString
} from "@lexical/markdown"
import { CodeNode } from "@lexical/code"
import { HorizontalRuleNode } from "@lexical/extension"
import { LinkNode } from "@lexical/link"
import { ListItemNode, ListNode } from "@lexical/list"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { describe, expect, it, vi } from "vite-plus/test"
import {
  $getRoot,
  $isElementNode,
  createEditor,
  type LexicalNode
} from "lexical"
import * as Schema from "effect/Schema"
import { TicketId } from "@projectproject/shared"
import { MentionNode } from "./Lexical/MentionNode"
import { AttachmentNode } from "./Lexical/AttachmentNode"
import { FigmaNode } from "./Lexical/FigmaNode"
import {
  attachmentsForDescription,
  AUTO_LINK_MATCHERS,
  createCoalescedSaveQueue,
  MARKDOWN_TRANSFORMERS,
  nextMarkdownChange,
  transformersForAttachments
} from "./LexicalEditor"

function matchAutoLink(text: string) {
  for (const matcher of AUTO_LINK_MATCHERS) {
    const match = matcher(text)
    if (match) return match
  }
  return null
}

function roundTripMarkdown(markdown: string) {
  const editor = createEditor({
    namespace: "lexical-editor-test",
    nodes: [
      TableNode,
      TableRowNode,
      TableCellNode,
      CodeNode,
      FigmaNode,
      HeadingNode,
      HorizontalRuleNode,
      LinkNode,
      ListNode,
      ListItemNode,
      MentionNode,
      QuoteNode
    ],
    onError: (error) => {
      throw error
    }
  })

  let exported = ""

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS)
      exported = $convertToMarkdownString(MARKDOWN_TRANSFORMERS)
    },
    { discrete: true }
  )

  return exported
}

const ATTACHMENT_ID = "01JBX7Q2K9ZWCVE8MTQ4RXPGHN"
const ATTACHMENT_URL = `/api/attachments/acme/${ATTACHMENT_ID}`
const ATTACHMENT_MARKDOWN = `![shot](${ATTACHMENT_URL})`

function descriptionAttachments(storageActive: boolean) {
  return attachmentsForDescription({
    orgSlug: "acme",
    slug: "web",
    ticketId: Schema.decodeUnknownSync(TicketId)("T-1"),
    storageActive
  })
}

function inAttachmentEditor<A>(
  parseTransformers: ReturnType<typeof transformersForAttachments>,
  run: () => A
) {
  const editor = createEditor({
    namespace: "lexical-editor-test",
    nodes: [
      TableNode,
      TableRowNode,
      TableCellNode,
      AttachmentNode,
      CodeNode,
      HeadingNode,
      HorizontalRuleNode,
      LinkNode,
      ListNode,
      ListItemNode,
      MentionNode,
      QuoteNode
    ],
    onError: (error) => {
      throw error
    }
  })

  const captured: Array<A> = []

  editor.update(
    () => {
      $convertFromMarkdownString(ATTACHMENT_MARKDOWN, parseTransformers)
      captured.push(run())
    },
    { discrete: true }
  )

  const result = captured[0]
  if (result === undefined) throw new Error("editor update did not run")
  return result
}

function roundTripAttachmentMarkdown(markdown: string) {
  const transformers = transformersForAttachments(descriptionAttachments(true))
  const editor = createEditor({
    namespace: "lexical-editor-test",
    nodes: [
      TableNode,
      TableRowNode,
      TableCellNode,
      AttachmentNode,
      CodeNode,
      FigmaNode,
      HeadingNode,
      HorizontalRuleNode,
      LinkNode,
      ListNode,
      ListItemNode,
      MentionNode,
      QuoteNode
    ],
    onError: (error) => {
      throw error
    }
  })

  let exported = ""

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers)
      exported = $convertToMarkdownString(transformers)
    },
    { discrete: true }
  )

  return exported
}

const FIGMA_KEY = "aBcDeF1234567890GhIjKl"
const FIGMA_URL = `https://figma.com/design/${FIGMA_KEY}/Checkout?node-id=1-2`
const FIGMA_MARKDOWN = `[Checkout](${FIGMA_URL})`

function markdownNodeTypes(
  markdown: string,
  transformers: ReturnType<typeof transformersForAttachments>
) {
  const editor = createEditor({
    namespace: "lexical-editor-test",
    nodes: [
      TableNode,
      TableRowNode,
      TableCellNode,
      AttachmentNode,
      CodeNode,
      FigmaNode,
      HeadingNode,
      HorizontalRuleNode,
      LinkNode,
      ListNode,
      ListItemNode,
      MentionNode,
      QuoteNode
    ],
    onError: (error) => {
      throw error
    }
  })

  const types: Array<string> = []

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers)
      const visit = (node: LexicalNode) => {
        types.push(node.getType())
        if ($isElementNode(node)) node.getChildren().forEach(visit)
      }
      $getRoot().getChildren().forEach(visit)
    },
    { discrete: true }
  )

  return types
}

describe("nextMarkdownChange", () => {
  it("records the first content edit after initialization", () => {
    expect(nextMarkdownChange("", "pasted text")).toBe("pasted text")
  })

  it("ignores updates that serialize to the loaded markdown", () => {
    expect(nextMarkdownChange("unchanged", "unchanged")).toBeNull()
  })
})

describe("createCoalescedSaveQueue", () => {
  it("debounces queued changes down to the latest value", async () => {
    const save = vi.fn(async () => {})
    const queue = createCoalescedSaveQueue({
      save,
      schedule: vi.fn(),
      onStatus: vi.fn(),
      onError: vi.fn()
    })

    queue.enqueue("first")
    queue.enqueue("latest")
    await queue.flush()

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith("latest")
  })

  it("coalesces edits made during a save and keeps their status dirty", async () => {
    let finishFirstSave: (() => void) | undefined
    const save = vi.fn((value: string) =>
      value === "first"
        ? new Promise<void>((resolve) => {
            finishFirstSave = resolve
          })
        : Promise.resolve()
    )
    const schedule = vi.fn()
    const onStatus = vi.fn()
    const queue = createCoalescedSaveQueue({
      save,
      schedule,
      onStatus,
      onError: vi.fn()
    })

    queue.enqueue("first")
    const firstSave = queue.flush()
    queue.enqueue("second")
    queue.enqueue("latest")
    finishFirstSave?.()
    await firstSave

    expect(onStatus).not.toHaveBeenCalledWith("saved")
    expect(schedule).toHaveBeenCalledTimes(1)

    await queue.flush()

    expect(save).toHaveBeenNthCalledWith(1, "first")
    expect(save).toHaveBeenNthCalledWith(2, "latest")
    expect(onStatus).toHaveBeenLastCalledWith("saved")
  })

  it("keeps a failed save queued for retry", async () => {
    const save = vi
      .fn<(value: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue()
    const schedule = vi.fn()
    const onStatus = vi.fn()
    const onError = vi.fn()
    const queue = createCoalescedSaveQueue({
      save,
      schedule,
      onStatus,
      onError
    })

    queue.enqueue("latest")
    await queue.flush()

    expect(onError).toHaveBeenCalledOnce()
    expect(onStatus).toHaveBeenLastCalledWith("dirty")
    expect(schedule).not.toHaveBeenCalled()

    await queue.flush()

    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenNthCalledWith(2, "latest")
    expect(onStatus).toHaveBeenLastCalledWith("saved")
  })
})

describe("AUTO_LINK_MATCHERS", () => {
  it("matches absolute http URLs", () => {
    expect(matchAutoLink("https://example.com")).toMatchObject({
      text: "https://example.com",
      url: "https://example.com"
    })
  })

  it("normalizes www URLs", () => {
    expect(matchAutoLink("www.example.com")).toMatchObject({
      text: "www.example.com",
      url: "https://www.example.com"
    })
  })

  it("normalizes email addresses", () => {
    expect(matchAutoLink("hello@example.com")).toMatchObject({
      text: "hello@example.com",
      url: "mailto:hello@example.com"
    })
  })

  it("does not match mention URLs", () => {
    expect(matchAutoLink("mention:user/github_42")).toBeNull()
  })

  it("does not match bare domains without www", () => {
    expect(matchAutoLink("example.com")).toBeNull()
  })
})

describe("MARKDOWN_TRANSFORMERS", () => {
  it("round-trips markdown links", () => {
    expect(roundTripMarkdown("See [docs](https://example.com).")).toBe(
      "See [docs](https://example.com)."
    )
  })

  it("round-trips mention links as mentions", () => {
    expect(roundTripMarkdown("See [Wouter](mention:user/github_42).")).toBe(
      "See [Wouter](mention:user/github_42)."
    )
  })
})

describe("figma links in the assembled transformer pipeline", () => {
  it("round-trips a figma design link with a node id", () => {
    const line = `See ${FIGMA_MARKDOWN} for the flow.`
    expect(roundTripMarkdown(line)).toBe(line)
  })

  it("parses a figma link into a figma node, not a link node", () => {
    const types = markdownNodeTypes(FIGMA_MARKDOWN, MARKDOWN_TRANSFORMERS)
    expect(types).toContain("figma")
    expect(types).not.toContain("link")
    expect(types).not.toContain("attachment")
  })

  it("round-trips the compact density param", () => {
    const line = `[Checkout](${FIGMA_URL}&pp-density=compact)`
    expect(roundTripMarkdown(line)).toBe(line)
  })

  it("leaves a link without a density param without one", () => {
    expect(roundTripMarkdown(FIGMA_MARKDOWN)).toBe(FIGMA_MARKDOWN)
    expect(roundTripMarkdown(FIGMA_MARKDOWN)).not.toContain("pp-density")
  })

  it("keeps a figma link, an attachment and an ordinary link intact in one document", () => {
    const line = `${FIGMA_MARKDOWN} ${ATTACHMENT_MARKDOWN} [docs](https://example.com/x)`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("gives each link in a mixed document its own node type", () => {
    const line = `${FIGMA_MARKDOWN} ${ATTACHMENT_MARKDOWN} [docs](https://example.com/x)`
    const types = markdownNodeTypes(
      line,
      transformersForAttachments(descriptionAttachments(true))
    )
    expect(types.filter((type) => type === "figma")).toHaveLength(1)
    expect(types.filter((type) => type === "attachment")).toHaveLength(1)
    expect(types.filter((type) => type === "link")).toHaveLength(1)
  })

  it("does not claim a non-figma host that resembles a figma path", () => {
    const line = `[A](https://notfigma.test/design/${FIGMA_KEY}/A)`
    expect(roundTripMarkdown(line)).toBe(line)
    const types = markdownNodeTypes(line, MARKDOWN_TRANSFORMERS)
    expect(types).toContain("link")
    expect(types).not.toContain("figma")
  })
})

describe("description editor attachment transformers", () => {
  it("parses attachment markdown into an inline attachment node inside a paragraph, before storage status is known", () => {
    const shape = inAttachmentEditor(
      transformersForAttachments(descriptionAttachments(false)),
      () =>
        $getRoot()
          .getChildren()
          .map((child) => ({
            type: child.getType(),
            children: $isElementNode(child)
              ? child.getChildren().map((grandchild) => grandchild.getType())
              : []
          }))
    )

    const types = shape.flatMap((entry) => [entry.type, ...entry.children])
    expect(shape.map((entry) => entry.type)).toContain("paragraph")
    expect(types).toContain("attachment")
    expect(types).not.toContain("link")
  })

  it("keeps two attachments on one line so they render side by side", () => {
    const second = `/api/attachments/acme/01JBX7Q2K9ZWCVE8MTQ4RXPGHM`
    const line = `${ATTACHMENT_MARKDOWN} ![other](${second})`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("keeps an attachment inline in a sentence", () => {
    const line = `see ${ATTACHMENT_MARKDOWN} for the crash`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("keeps leading text and several attachments on the same line", () => {
    const second = `/api/attachments/acme/01JBX7Q2K9ZWCVE8MTQ4RXPGHM`
    const line = `Four in a row: ${ATTACHMENT_MARKDOWN} ![b](${second})`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("keeps leading text and four attachments on the same line", () => {
    const ids = [
      "01JBX7Q2K9ZWCVE8MTQ4RXPGHM",
      "01JBX7Q2K9ZWCVE8MTQ4RXPGHP",
      "01JBX7Q2K9ZWCVE8MTQ4RXPGHQ"
    ]
    const rest = ids
      .map((id, index) => `[f${index}](/api/attachments/acme/${id})`)
      .join(" ")
    const line = `Four in a row: ${ATTACHMENT_MARKDOWN} ${rest}`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("keeps a document whose blocks surround an attachment line intact", () => {
    const doc = `# Attachment smoke test\n\nFour in a row: ${ATTACHMENT_MARKDOWN}\n\nCompact inline: see [b](${ATTACHMENT_URL}?d=compact) for details.`
    expect(roundTripAttachmentMarkdown(doc)).toBe(doc)
  })

  it("round-trips the compact density param", () => {
    const line = `![shot](${ATTACHMENT_URL}?d=compact)`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("round-trips width and density together", () => {
    const line = `![shot](${ATTACHMENT_URL}?w=240&d=compact)`
    expect(roundTripAttachmentMarkdown(line)).toBe(line)
  })

  it("serializes a committed attachment back to markdown when uploads are disabled", () => {
    const exported = inAttachmentEditor(
      transformersForAttachments(descriptionAttachments(true)),
      () =>
        $convertToMarkdownString(
          transformersForAttachments(descriptionAttachments(false))
        )
    )

    expect(exported).toBe(ATTACHMENT_MARKDOWN)
    expect(exported).not.toBe("shot")
  })

  it("degrades an attachment node to its bare filename without the attachment transformer, which is why the description callsite always supplies it", () => {
    const exported = inAttachmentEditor(
      transformersForAttachments(descriptionAttachments(true)),
      () => $convertToMarkdownString(MARKDOWN_TRANSFORMERS)
    )

    expect(exported).toBe("shot")
  })

  it("keeps attachment markdown out of the transformer list for callsites without attachments", () => {
    expect(transformersForAttachments(undefined)).toBe(MARKDOWN_TRANSFORMERS)
  })
})

it("preserves mentions and fenced examples alongside an editable table", () => {
  const markdown =
    "| Owner | Example |\n| --- | --- |\n| [Ticket](mention:ticket/T-157) | `a\\|b` |\n\n```md\n| literal | table |\n| --- | --- |\n```"
  expect(roundTripMarkdown(markdown)).toBe(markdown)
})

it.each(["---", "***", "___"])(
  "keeps %s after a table as a separate horizontal rule",
  (rule) => {
    const table = "| A | B |\n| --- | --- |\n| one | two |"
    expect(roundTripMarkdown(`${table}\n${rule}\nAfter`)).toBe(
      `${table}\n\n---\n\nAfter`
    )
  }
)

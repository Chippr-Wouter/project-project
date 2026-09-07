import {
  $convertFromMarkdownString,
  $convertToMarkdownString
} from "@lexical/markdown"
import { CodeNode } from "@lexical/code"
import { HorizontalRuleNode } from "@lexical/extension"
import { LinkNode } from "@lexical/link"
import { ListItemNode, ListNode } from "@lexical/list"
import { HeadingNode, QuoteNode } from "@lexical/rich-text"
import { describe, expect, it } from "vite-plus/test"
import { $getRoot, $isElementNode, createEditor } from "lexical"
import * as Schema from "effect/Schema"
import { TicketId } from "@projectproject/shared"
import { MentionNode } from "./Lexical/MentionNode"
import { AttachmentNode } from "./Lexical/AttachmentNode"
import {
  attachmentsForDescription,
  AUTO_LINK_MATCHERS,
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

describe("nextMarkdownChange", () => {
  it("records the first content edit after initialization", () => {
    expect(nextMarkdownChange("", "pasted text")).toBe("pasted text")
  })

  it("ignores updates that serialize to the loaded markdown", () => {
    expect(nextMarkdownChange("unchanged", "unchanged")).toBeNull()
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

import { describe, expect, it } from "vite-plus/test"
import {
  formatAttachmentMarkdown,
  attachmentViewParams,
  parseAttachmentUrl
} from "@projectproject/shared"
import {
  ATTACHMENT_MARKDOWN_RE,
  unescapeAttachmentAlt
} from "./attachmentTransformer"

const ID = "01JBX7Q2K9ZWCVE8MTQ4RXPGHN"
const URL = `/api/attachments/acme/${ID}`

describe("ATTACHMENT_MARKDOWN_RE", () => {
  it("matches an image attachment", () => {
    const match = `![shot](${URL})`.match(ATTACHMENT_MARKDOWN_RE)
    expect(match).not.toBeNull()
    expect(match![1]).toBe("!")
    expect(match![2]).toBe("shot")
    expect(match![3]).toBe(URL)
  })

  it("matches a file attachment link", () => {
    const match = `[report.pdf](${URL})`.match(ATTACHMENT_MARKDOWN_RE)
    expect(match).not.toBeNull()
    expect(match![1]).toBe("")
    expect(match![2]).toBe("report.pdf")
  })

  it("does not match an external image", () => {
    expect(
      "![x](https://example.test/a.png)".match(ATTACHMENT_MARKDOWN_RE)
    ).toBeNull()
  })

  it("does not match a mention link", () => {
    expect("[T-1](mention:ticket/T-1)".match(ATTACHMENT_MARKDOWN_RE)).toBeNull()
  })
})

describe("formatAttachmentMarkdown", () => {
  it("writes an image as a bang link", () => {
    expect(
      formatAttachmentMarkdown({ kind: "image", alt: "shot", url: URL })
    ).toBe(`![shot](${URL})`)
  })

  it("writes a file as a plain link", () => {
    expect(
      formatAttachmentMarkdown({ kind: "file", alt: "report.pdf", url: URL })
    ).toBe(`[report.pdf](${URL})`)
  })

  it("escapes a bracket in the alt text", () => {
    expect(
      formatAttachmentMarkdown({ kind: "image", alt: "a[b]c", url: URL })
    ).toBe(`![a\\[b\\]c](${URL})`)
  })

  it("round-trips through the regex", () => {
    const md = formatAttachmentMarkdown({
      kind: "image",
      alt: "shot",
      url: URL
    })
    expect(md.match(ATTACHMENT_MARKDOWN_RE)![3]).toBe(URL)
  })

  it("round-trips an alt text containing brackets back to the original filename", () => {
    const alt = "shot [1].png"
    const md = formatAttachmentMarkdown({ kind: "image", alt, url: URL })
    const match = md.match(ATTACHMENT_MARKDOWN_RE)
    expect(match).not.toBeNull()
    expect(unescapeAttachmentAlt(match![2])).toBe(alt)
    expect(match![3]).toBe(URL)
  })

  it("round-trips an alt text containing a backslash", () => {
    const alt = "a\\b.png"
    const md = formatAttachmentMarkdown({ kind: "image", alt, url: URL })
    const match = md.match(ATTACHMENT_MARKDOWN_RE)
    expect(match).not.toBeNull()
    expect(unescapeAttachmentAlt(match![2])).toBe(alt)
  })
})

describe("formatAttachmentMarkdown width round-trip", () => {
  it("writes a width as a query param", () => {
    expect(
      formatAttachmentMarkdown({
        kind: "image",
        alt: "shot",
        url: URL,
        width: 420
      })
    ).toBe(`![shot](${URL}?w=420)`)
  })

  it("omits the query when there is no width", () => {
    expect(
      formatAttachmentMarkdown({
        kind: "image",
        alt: "shot",
        url: URL,
        width: null
      })
    ).toBe(`![shot](${URL})`)
  })

  it("keeps a sized url matchable by the transformer regex", () => {
    const md = formatAttachmentMarkdown({
      kind: "image",
      alt: "shot",
      url: URL,
      width: 420
    })
    const match = md.match(ATTACHMENT_MARKDOWN_RE)
    expect(match).not.toBeNull()
    expect(match![3]).toBe(`${URL}?w=420`)
  })

  it("keeps a sized url parseable and reference-scannable", () => {
    const md = formatAttachmentMarkdown({
      kind: "image",
      alt: "shot",
      url: URL,
      width: 420
    })
    const url = md.match(ATTACHMENT_MARKDOWN_RE)![3]!
    expect(parseAttachmentUrl(url)).not.toBeNull()
    expect(attachmentViewParams(url).width).toBe(420)
  })
})

describe("formatAttachmentMarkdown density round-trip", () => {
  it("writes the compact density as a query param", () => {
    expect(
      formatAttachmentMarkdown({
        kind: "file",
        alt: "bundle.zip",
        url: URL,
        density: "compact"
      })
    ).toBe(`[bundle.zip](${URL}?d=compact)`)
  })

  it("omits the query for the rich default", () => {
    expect(
      formatAttachmentMarkdown({
        kind: "file",
        alt: "bundle.zip",
        url: URL,
        density: "rich"
      })
    ).toBe(`[bundle.zip](${URL})`)
  })

  it("keeps a compact url matchable and readable", () => {
    const md = formatAttachmentMarkdown({
      kind: "image",
      alt: "shot",
      url: URL,
      width: 240,
      density: "compact"
    })
    const url = md.match(ATTACHMENT_MARKDOWN_RE)![3]
    expect(parseAttachmentUrl(url)).not.toBeNull()
    expect(attachmentViewParams(url).width).toBe(240)
    expect(attachmentViewParams(url).density).toBe("compact")
  })
})

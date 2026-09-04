import { describe, expect, it } from "vitest"
import { FIGMA_MARKDOWN_RE, formatFigmaMarkdown } from "./figmaTransformer"

const KEY = "aBcDeF1234567890GhIjKl"

describe("formatFigmaMarkdown", () => {
  it("writes a plain markdown link", () => {
    expect(
      formatFigmaMarkdown({
        label: "Checkout",
        url: `https://figma.com/design/${KEY}/Checkout?node-id=1-2`,
        density: "rich"
      })
    ).toBe(`[Checkout](https://figma.com/design/${KEY}/Checkout?node-id=1-2)`)
  })

  it("carries compact density on the url", () => {
    const out = formatFigmaMarkdown({
      label: "Checkout",
      url: `https://figma.com/design/${KEY}/Checkout`,
      density: "compact"
    })
    expect(out).toContain("pp-density=compact")
  })

  it("escapes brackets in the label", () => {
    const out = formatFigmaMarkdown({
      label: "A [weird] name",
      url: `https://figma.com/design/${KEY}/A`,
      density: "rich"
    })
    expect(out).toContain("A \\[weird\\] name")
  })
})

describe("FIGMA_MARKDOWN_RE", () => {
  it("matches a figma markdown link", () => {
    const md = `[Checkout](https://figma.com/design/${KEY}/Checkout?node-id=1-2)`
    expect(FIGMA_MARKDOWN_RE.test(md)).toBe(true)
  })

  it("does not match a non-figma link", () => {
    expect(FIGMA_MARKDOWN_RE.test("[Docs](https://example.test/a)")).toBe(false)
  })

  it("does not match an attachment link", () => {
    expect(
      FIGMA_MARKDOWN_RE.test("[f](/api/attachments/acme/01JBX7Q2K9ZWCVE8MTQ4RXPGHN)")
    ).toBe(false)
  })
})

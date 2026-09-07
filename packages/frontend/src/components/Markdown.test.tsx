import { describe, expect, it } from "vite-plus/test"
import { render, screen } from "@testing-library/react"
import { Markdown } from "./Markdown"

const ID = "01JBX7Q2K9ZWCVE8MTQ4RXPGHN"

describe("Markdown attachments", () => {
  it("renders an attachment image with a lazy loading hint", () => {
    render(<Markdown>{`![shot](/api/attachments/acme/${ID})`}</Markdown>)
    const img = screen.getByAltText("shot")
    expect(img.getAttribute("src")).toBe(`/api/attachments/acme/${ID}`)
    expect(img.getAttribute("loading")).toBe("lazy")
  })

  it("keeps an external image working", () => {
    render(<Markdown>{"![ext](https://example.test/a.png)"}</Markdown>)
    expect(screen.getByAltText("ext").getAttribute("src")).toBe(
      "https://example.test/a.png"
    )
  })

  it("still renders mention chips", () => {
    render(<Markdown>{"[T-1](mention:ticket/T-1)"}</Markdown>)
    expect(screen.getByText("T-1")).toBeDefined()
  })

  it("strips a javascript: image url", () => {
    render(<Markdown>{"![x](javascript:alert(1))"}</Markdown>)
    const src = screen.getByAltText("x").getAttribute("src") ?? ""
    expect(src.startsWith("javascript:")).toBe(false)
  })
})

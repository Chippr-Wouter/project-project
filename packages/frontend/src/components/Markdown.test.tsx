import { afterEach, describe, expect, it } from "vite-plus/test"
import { cleanup, render, screen } from "@testing-library/react"
import { formatAttachmentMarkdown } from "@projectproject/shared"
import { Markdown } from "./Markdown"

afterEach(cleanup)

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

describe("Markdown attachment density", () => {
  it("renders compact images as chips without an expanded image", () => {
    render(
      <Markdown>{`![shot](/api/attachments/acme/${ID}?w=320&d=compact)`}</Markdown>
    )
    expect(screen.getByText("shot")).toBeDefined()
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.getByRole("link").getAttribute("download")).toBe("shot")
    expect(screen.getByRole("link").getAttribute("href")).toBe(
      `/api/attachments/acme/${ID}`
    )
  })

  it("renders compact file attachments as download chips", () => {
    render(
      <Markdown>{`[archive.zip](/api/attachments/acme/${ID}?d=compact)`}</Markdown>
    )
    expect(screen.getByText("archive.zip")).toBeDefined()
    expect(screen.getByRole("link").getAttribute("download")).toBe(
      "archive.zip"
    )
  })

  it("keeps rich image width", () => {
    render(<Markdown>{`![shot](/api/attachments/acme/${ID}?w=320)`}</Markdown>)
    expect(screen.getByAltText("shot").style.width).toBe("320px")
  })

  it("does not treat external image parameters as attachment density", () => {
    render(
      <Markdown>{"![ext](https://example.test/a.png?d=compact)"}</Markdown>
    )
    expect(screen.getByAltText("ext")).toBeDefined()
  })

  it("preserves ordinary and rich attachment links", () => {
    render(
      <Markdown>{`[archive.zip](/api/attachments/acme/${ID}) and [external](https://example.test/?d=compact)`}</Markdown>
    )
    expect(
      screen.getByRole("link", { name: "archive.zip" }).hasAttribute("download")
    ).toBe(false)
    expect(
      screen.getByRole("link", { name: "external" }).getAttribute("href")
    ).toBe("https://example.test/?d=compact")
  })
})

it("preserves filenames containing markdown syntax in compact chips", () => {
  const filename = "a*bold*_name_`code`&copy;.zip"
  render(
    <Markdown>
      {formatAttachmentMarkdown({
        kind: "file",
        alt: filename,
        url: `/api/attachments/acme/${ID}`,
        density: "compact"
      })}
    </Markdown>
  )
  expect(screen.getByText(filename)).toBeDefined()
  expect(screen.getByRole("link").getAttribute("download")).toBe(filename)
})

it("keeps formatted labels readable on hand-authored compact links", () => {
  render(
    <Markdown>{`[**report**.pdf](/api/attachments/acme/${ID}?d=compact)`}</Markdown>
  )
  expect(screen.getByText("report.pdf")).toBeDefined()
})

it("preserves links around compact images without nesting download links", () => {
  render(
    <Markdown>{`[**![shot](/api/attachments/acme/${ID}?d=compact)**](https://example.test)`}</Markdown>
  )
  expect(screen.getAllByRole("link")).toHaveLength(1)
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "https://example.test"
  )
  expect(screen.getByText("shot")).toBeDefined()
  expect(screen.queryByRole("img")).toBeNull()
})

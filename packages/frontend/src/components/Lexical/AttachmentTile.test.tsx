import { afterEach, describe, expect, it } from "vite-plus/test"
import { cleanup, render, screen } from "@testing-library/react"
import { AttachmentTile } from "./AttachmentTile"

afterEach(cleanup)

const ID = "01JBX7Q2K9ZWCVE8MTQ4RXPGHN"
const URL = `/api/attachments/acme/${ID}`
const MORPH_ID = `attachment-${ID}`

describe("AttachmentTile", () => {
  it("labels a zip archive and links the download", () => {
    render(
      <AttachmentTile
        url={URL}
        alt="bundle"
        filename="bundle.zip"
        morphId={MORPH_ID}
      />
    )
    expect(screen.getByText("Zip")).toBeDefined()
    const link = screen.getByLabelText("Download")
    expect(link.getAttribute("href")).toBe(URL)
    expect(link.getAttribute("download")).toBe("bundle.zip")
  })

  it("labels tar and gzip archives distinctly", () => {
    render(
      <AttachmentTile
        url={URL}
        alt="logs"
        filename="logs.tar"
        morphId={MORPH_ID}
      />
    )
    expect(screen.getByText("Tar")).toBeDefined()
    cleanup()
    render(
      <AttachmentTile
        url={URL}
        alt="logs"
        filename="logs.tar.gz"
        morphId={MORPH_ID}
      />
    )
    expect(screen.getByText("Gzip")).toBeDefined()
  })

  it("falls back to a generic label for an unknown extension", () => {
    render(
      <AttachmentTile
        url={URL}
        alt="notes"
        filename="notes.txt"
        morphId={MORPH_ID}
      />
    )
    expect(screen.getByText("File")).toBeDefined()
  })

  it("shows the filename", () => {
    render(
      <AttachmentTile
        url={URL}
        alt="bundle"
        filename="bundle.zip"
        morphId={MORPH_ID}
      />
    )
    expect(screen.getByTitle("bundle.zip").textContent).toBe("bundle.zip")
  })
})

import { describe, expect, it } from "vite-plus/test"
import { splitPastedAttachments } from "./pastedAttachments"

const ID = "01JBX7Q2K9ZWCVE8MTQ4RXPGHN"
const URL = `/api/attachments/acme/${ID}`

describe("splitPastedAttachments", () => {
  it("finds nothing to convert in ordinary prose", () => {
    expect(splitPastedAttachments("just some text")).toBeNull()
  })

  it("converts an image reference on its own", () => {
    expect(splitPastedAttachments(`![shot.png](${URL})`)).toEqual([
      { type: "attachment", kind: "image", alt: "shot.png", url: URL }
    ])
  })

  it("converts a file reference on its own", () => {
    expect(splitPastedAttachments(`[bundle.zip](${URL})`)).toEqual([
      { type: "attachment", kind: "file", alt: "bundle.zip", url: URL }
    ])
  })

  it("keeps the prose around a reference", () => {
    expect(splitPastedAttachments(`see ![a](${URL}) here`)).toEqual([
      { type: "text", value: "see " },
      { type: "attachment", kind: "image", alt: "a", url: URL },
      { type: "text", value: " here" }
    ])
  })

  it("converts several references in one paste", () => {
    const parts = splitPastedAttachments(`![a](${URL}) and [b](${URL})`)
    expect(parts?.filter((p) => p.type === "attachment")).toHaveLength(2)
  })

  it("keeps a width parameter on the url so the paste round-trips", () => {
    expect(splitPastedAttachments(`![a](${URL}?w=320)`)).toEqual([
      { type: "attachment", kind: "image", alt: "a", url: `${URL}?w=320` }
    ])
  })

  it("unescapes an alt that had brackets escaped", () => {
    expect(splitPastedAttachments(`![a\\[1\\]](${URL})`)).toEqual([
      { type: "attachment", kind: "image", alt: "a[1]", url: URL }
    ])
  })

  it("leaves a markdown link that is not an attachment alone", () => {
    expect(splitPastedAttachments("[docs](https://example.com)")).toBeNull()
  })
})

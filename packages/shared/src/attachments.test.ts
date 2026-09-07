import { describe, expect, it } from "vite-plus/test"
import {
  attachmentDownloadUrl,
  attachmentFileFormat,
  attachmentUrl,
  attachmentViewParams,
  extractAttachmentRefs,
  parseAttachmentUrl,
  withAttachmentParams
} from "./attachments"
import {
  ATTACHMENT_MIN_WIDTH,
  clampAttachmentWidth,
  isAllowedAttachmentContentType,
  isRasterImageContentType
} from "./schemas/Attachment"

const ID = "01JBX7Q2K9ZWCVE8MTQ4RXPGHN"

const widthOf = (url: string) => attachmentViewParams(url).width
const densityOf = (url: string) => attachmentViewParams(url).density

describe("attachmentUrl", () => {
  it("builds an app-relative url", () => {
    expect(attachmentUrl("acme", ID)).toBe(`/api/attachments/acme/${ID}`)
  })

  it("round-trips through parseAttachmentUrl", () => {
    expect(parseAttachmentUrl(attachmentUrl("acme", ID))).toEqual({
      orgSlug: "acme",
      id: ID
    })
  })
})

describe("parseAttachmentUrl", () => {
  it("rejects an absolute url", () => {
    expect(
      parseAttachmentUrl(`https://evil.test/api/attachments/acme/${ID}`)
    ).toBeNull()
  })

  it("rejects a missing segment", () => {
    expect(parseAttachmentUrl(`/api/attachments/${ID}`)).toBeNull()
  })

  it("rejects a trailing segment", () => {
    expect(parseAttachmentUrl(`/api/attachments/acme/${ID}/raw`)).toBeNull()
  })

  it("rejects a non-ulid id", () => {
    expect(parseAttachmentUrl("/api/attachments/acme/not-a-ulid")).toBeNull()
  })

  it("rejects a path-traversal id", () => {
    expect(parseAttachmentUrl("/api/attachments/acme/..%2f..%2fetc")).toBeNull()
  })
})

describe("extractAttachmentRefs (permissive: false negatives are data loss)", () => {
  it("finds an image reference", () => {
    const md = `# Title\n\n![shot](/api/attachments/acme/${ID})\n`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds a plain link reference", () => {
    const md = `[report.pdf](/api/attachments/acme/${ID})`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds nested brackets in alt text", () => {
    const md = `![Diagram [v2]](/api/attachments/acme/${ID})`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds nested brackets in link text", () => {
    const md = `[report [final].pdf](/api/attachments/acme/${ID})`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds a url with query string", () => {
    const md = `![x](/api/attachments/acme/${ID}?v=2)`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds a url with fragment", () => {
    const md = `[x](/api/attachments/acme/${ID}#page=3)`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds a bare url with no markdown syntax", () => {
    const md = `see /api/attachments/acme/${ID} for details`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("finds a bare url followed by prose punctuation", () => {
    for (const suffix of [".", ",", ";", ":", "!", "?", ")", "'", '"']) {
      expect(
        extractAttachmentRefs(`see /api/attachments/acme/${ID}${suffix}`)
      ).toEqual([{ orgSlug: "acme", id: ID }])
    }
  })

  it("finds a url at the very end of the body with no trailing newline", () => {
    expect(extractAttachmentRefs(`/api/attachments/acme/${ID}`)).toEqual([
      { orgSlug: "acme", id: ID }
    ])
  })

  it("finds a url inside a code fence", () => {
    const md = "```\n/api/attachments/acme/" + ID + "\n```"
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("ignores a non-attachment path", () => {
    const md = `![y](/api/other/acme/${ID})`
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  it("ignores mention links and external images", () => {
    const md =
      "[T-1](mention:ticket/T-1) ![x](https://example.test/a.png) ![y](/api/other/acme/x)"
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  it("deduplicates a reference used twice", () => {
    const md = `![a](/api/attachments/acme/${ID}) and ![b](/api/attachments/acme/${ID})`
    expect(extractAttachmentRefs(md)).toEqual([{ orgSlug: "acme", id: ID }])
  })

  it("ignores a malformed id", () => {
    const md = `![x](/api/attachments/acme/not-26-chars) ![y](/api/attachments/acme/01JBX7Q2K9ZWCVE8MTQ4RXPGHI)`
    expect(extractAttachmentRefs(md)).toEqual([])
  })

  it("returns an empty array for markdown with no attachments", () => {
    expect(extractAttachmentRefs("just text")).toEqual([])
  })
})

describe("isAllowedAttachmentContentType", () => {
  it("allows png", () => {
    expect(isAllowedAttachmentContentType("image/png")).toBe(true)
  })

  it("allows pdf", () => {
    expect(isAllowedAttachmentContentType("application/pdf")).toBe(true)
  })

  it("rejects svg", () => {
    expect(isAllowedAttachmentContentType("image/svg+xml")).toBe(false)
  })

  it("rejects an executable", () => {
    expect(isAllowedAttachmentContentType("application/x-msdownload")).toBe(
      false
    )
  })

  it("normalizes case and parameters", () => {
    expect(isAllowedAttachmentContentType("IMAGE/PNG; charset=binary")).toBe(
      true
    )
  })
})

describe("isRasterImageContentType", () => {
  it("treats png as raster", () => {
    expect(isRasterImageContentType("image/png")).toBe(true)
  })

  it("does not treat pdf as raster", () => {
    expect(isRasterImageContentType("application/pdf")).toBe(false)
  })
})

describe("attachmentViewParams width", () => {
  it("reads an explicit width", () => {
    expect(widthOf(`/api/attachments/acme/${ID}?w=420`)).toBe(420)
  })

  it("returns null with no query", () => {
    expect(widthOf(`/api/attachments/acme/${ID}`)).toBeNull()
  })

  it("returns null for a non-numeric width", () => {
    expect(widthOf(`/api/attachments/acme/${ID}?w=wide`)).toBeNull()
  })

  it("returns null for a zero or negative width", () => {
    expect(widthOf(`/api/attachments/acme/${ID}?w=0`)).toBeNull()
    expect(widthOf(`/api/attachments/acme/${ID}?w=-10`)).toBeNull()
  })

  it("ignores unrelated params", () => {
    expect(widthOf(`/api/attachments/acme/${ID}?v=2`)).toBeNull()
  })
})

describe("withAttachmentParams", () => {
  it("appends a width", () => {
    expect(
      withAttachmentParams(`/api/attachments/acme/${ID}`, { width: 420 })
    ).toBe(`/api/attachments/acme/${ID}?w=420`)
  })

  it("replaces existing params rather than appending twice", () => {
    expect(
      withAttachmentParams(`/api/attachments/acme/${ID}?w=100&d=compact`, {
        width: 420
      })
    ).toBe(`/api/attachments/acme/${ID}?w=420`)
  })

  it("strips the width when given null", () => {
    expect(
      withAttachmentParams(`/api/attachments/acme/${ID}?w=420`, { width: null })
    ).toBe(`/api/attachments/acme/${ID}`)
  })

  it("rounds a fractional width", () => {
    expect(
      withAttachmentParams(`/api/attachments/acme/${ID}`, { width: 420.6 })
    ).toBe(`/api/attachments/acme/${ID}?w=421`)
  })

  it("never serializes a width that rounds to zero", () => {
    const url = withAttachmentParams(`/api/attachments/acme/${ID}`, {
      width: 0.4
    })
    expect(url).toBe(`/api/attachments/acme/${ID}?w=1`)
    expect(widthOf(url)).toBe(1)
  })

  it("omits the density param when rich", () => {
    expect(
      withAttachmentParams(`/api/attachments/acme/${ID}`, { density: "rich" })
    ).toBe(`/api/attachments/acme/${ID}`)
  })

  it("writes width and density together in a stable order", () => {
    expect(
      withAttachmentParams(`/api/attachments/acme/${ID}`, {
        width: 200,
        density: "compact"
      })
    ).toBe(`/api/attachments/acme/${ID}?w=200&d=compact`)
  })

  it("round-trips through the readers", () => {
    const url = withAttachmentParams(`/api/attachments/acme/${ID}`, {
      width: 333,
      density: "compact"
    })
    expect(widthOf(url)).toBe(333)
    expect(densityOf(url)).toBe("compact")
  })

  it("leaves a parameterised url servable and reapable", () => {
    const url = withAttachmentParams(`/api/attachments/acme/${ID}`, {
      width: 333,
      density: "compact"
    })
    expect(parseAttachmentUrl(url)).toEqual({ orgSlug: "acme", id: ID })
    expect(extractAttachmentRefs(`![a](${url})`)).toEqual([
      { orgSlug: "acme", id: ID }
    ])
  })
})

describe("attachmentViewParams density", () => {
  it("defaults to rich with no query", () => {
    expect(densityOf(`/api/attachments/acme/${ID}`)).toBe("rich")
  })

  it("reads compact", () => {
    expect(densityOf(`/api/attachments/acme/${ID}?d=compact`)).toBe("compact")
  })

  it("treats an unknown value as rich", () => {
    expect(densityOf(`/api/attachments/acme/${ID}?d=tiny`)).toBe("rich")
    expect(densityOf(`/api/attachments/acme/${ID}?w=200`)).toBe("rich")
  })
})

describe("clampAttachmentWidth", () => {
  const landscape = { naturalWidth: 2400, naturalHeight: 1800 }

  it("keeps a width inside every bound", () => {
    expect(
      clampAttachmentWidth({ width: 400, containerWidth: 800, ...landscape })
    ).toBe(400)
  })

  it("clamps to the container width when the image is wide enough that height never binds", () => {
    expect(
      clampAttachmentWidth({
        width: 5000,
        containerWidth: 700,
        naturalWidth: 4000,
        naturalHeight: 1000
      })
    ).toBe(700)
  })

  it("lets the height ceiling bind before the container for a 4:3 image", () => {
    expect(
      clampAttachmentWidth({ width: 5000, containerWidth: 700, ...landscape })
    ).toBe(512)
  })

  it("clamps a tall image so its height stays within the max height", () => {
    expect(
      clampAttachmentWidth({
        width: 5000,
        containerWidth: 4000,
        naturalWidth: 400,
        naturalHeight: 1200
      })
    ).toBe(128)
  })

  it("clamps up to the minimum width", () => {
    expect(
      clampAttachmentWidth({ width: 10, containerWidth: 800, ...landscape })
    ).toBe(ATTACHMENT_MIN_WIDTH)
  })

  it("never returns less than the minimum even in a tiny container", () => {
    expect(
      clampAttachmentWidth({ width: 10, containerWidth: 20, ...landscape })
    ).toBe(ATTACHMENT_MIN_WIDTH)
  })

  it("falls back to the container when natural dimensions are unknown", () => {
    expect(
      clampAttachmentWidth({
        width: 5000,
        containerWidth: 640,
        naturalWidth: 0,
        naturalHeight: 0
      })
    ).toBe(640)
  })
})

describe("attachmentFileFormat", () => {
  it("recognises each allowed archive and document format", () => {
    expect(attachmentFileFormat("report.pdf")).toBe("pdf")
    expect(attachmentFileFormat("bundle.zip")).toBe("zip")
    expect(attachmentFileFormat("logs.tar")).toBe("tar")
    expect(attachmentFileFormat("dump.gz")).toBe("gzip")
    expect(attachmentFileFormat("dump.gzip")).toBe("gzip")
  })

  it("prefers gzip over tar for double extensions", () => {
    expect(attachmentFileFormat("logs.tar.gz")).toBe("gzip")
    expect(attachmentFileFormat("logs.tgz")).toBe("gzip")
  })

  it("ignores case and surrounding whitespace", () => {
    expect(attachmentFileFormat("  Report.PDF ")).toBe("pdf")
  })

  it("matches on the last extension only", () => {
    expect(attachmentFileFormat("pdf.zip")).toBe("zip")
    expect(attachmentFileFormat("notes.pdf.txt")).toBe("generic")
  })

  it("falls back to generic for unknown, missing or bare extensions", () => {
    expect(attachmentFileFormat("notes.txt")).toBe("generic")
    expect(attachmentFileFormat("README")).toBe("generic")
    expect(attachmentFileFormat("")).toBe("generic")
    expect(attachmentFileFormat(".pdf")).toBe("generic")
  })
})

describe("attachmentDownloadUrl", () => {
  it("marks the serving url as a download", () => {
    expect(attachmentDownloadUrl("acme", "01M1H0S8X5DJTNBSAZSA1BZD2B")).toBe(
      "/api/attachments/acme/01M1H0S8X5DJTNBSAZSA1BZD2B?download=1"
    )
  })

  it("still parses back to the same attachment, so the route can resolve it", () => {
    expect(
      parseAttachmentUrl(
        attachmentDownloadUrl("acme", "01M1H0S8X5DJTNBSAZSA1BZD2B")
      )
    ).toEqual({ orgSlug: "acme", id: "01M1H0S8X5DJTNBSAZSA1BZD2B" })
  })
})

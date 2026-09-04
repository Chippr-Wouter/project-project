import { describe, expect, it } from "vitest"
import {
  extractFigmaRefs,
  figmaEmbedUrl,
  figmaRefKey,
  figmaSrc,
  figmaViewParams,
  parseFigmaUrl,
  withFigmaParams
} from "./figma"

const KEY = "aBcDeF1234567890GhIjKl"

describe("parseFigmaUrl", () => {
  it("parses a design url with a node id", () => {
    expect(
      parseFigmaUrl(`https://www.figma.com/design/${KEY}/Checkout?node-id=12-345`)
    ).toEqual({
      kind: "design",
      fileKey: KEY,
      nodeId: "12:345",
      slug: "Checkout"
    })
  })

  it("normalises a node id that already uses a colon", () => {
    expect(
      parseFigmaUrl(`https://figma.com/design/${KEY}/Checkout?node-id=12%3A345`)
        ?.nodeId
    ).toBe("12:345")
  })

  it("returns a null node id when none is present", () => {
    expect(parseFigmaUrl(`https://figma.com/design/${KEY}/Checkout`)?.nodeId).toBeNull()
  })

  it("parses board, slides, proto and legacy file urls", () => {
    const kinds = [
      ["board", "board"],
      ["slides", "slides"],
      ["proto", "proto"],
      ["file", "design"]
    ] as const
    for (const [segment, kind] of kinds) {
      expect(parseFigmaUrl(`https://figma.com/${segment}/${KEY}/Name`)?.kind).toBe(kind)
    }
  })

  it("decodes a percent-encoded slug", () => {
    expect(parseFigmaUrl(`https://figma.com/design/${KEY}/Design%20System`)?.slug).toBe(
      "Design System"
    )
  })

  it("tolerates a missing slug", () => {
    expect(parseFigmaUrl(`https://figma.com/design/${KEY}`)).toEqual({
      kind: "design",
      fileKey: KEY,
      nodeId: null,
      slug: ""
    })
  })

  it("rejects a non-figma host", () => {
    expect(parseFigmaUrl(`https://notfigma.test/design/${KEY}/Checkout`)).toBeNull()
  })

  it("rejects a lookalike host", () => {
    expect(parseFigmaUrl(`https://figma.com.evil.test/design/${KEY}/Checkout`)).toBeNull()
  })

  it("rejects an unknown path segment", () => {
    expect(parseFigmaUrl(`https://figma.com/community/${KEY}/Checkout`)).toBeNull()
  })

  it("rejects a url with no file key", () => {
    expect(parseFigmaUrl("https://figma.com/design/")).toBeNull()
  })

  it("rejects unparseable input", () => {
    expect(parseFigmaUrl("not a url")).toBeNull()
  })
})

describe("figmaViewParams", () => {
  it("defaults to rich", () => {
    expect(figmaViewParams(`https://figma.com/design/${KEY}/N`).density).toBe("rich")
  })

  it("reads compact from pp-density", () => {
    expect(
      figmaViewParams(`https://figma.com/design/${KEY}/N?pp-density=compact`).density
    ).toBe("compact")
  })
})

describe("withFigmaParams", () => {
  it("adds pp-density without dropping figma's own params", () => {
    const out = withFigmaParams(
      `https://figma.com/design/${KEY}/N?node-id=1-2`,
      { density: "compact" }
    )
    expect(out).toContain("node-id=1-2")
    expect(out).toContain("pp-density=compact")
  })

  it("omits pp-density when rich", () => {
    const out = withFigmaParams(`https://figma.com/design/${KEY}/N`, {
      density: "rich"
    })
    expect(out).not.toContain("pp-density")
  })

  it("replaces an existing pp-density rather than appending", () => {
    const out = withFigmaParams(
      `https://figma.com/design/${KEY}/N?pp-density=compact`,
      { density: "rich" }
    )
    expect(out).not.toContain("pp-density")
  })

  it("round-trips through figmaViewParams", () => {
    const out = withFigmaParams(`https://figma.com/design/${KEY}/N`, {
      density: "compact"
    })
    expect(figmaViewParams(out).density).toBe("compact")
  })
})

describe("figmaEmbedUrl", () => {
  it("builds an embed url carrying the node id", () => {
    const url = `https://figma.com/design/${KEY}/N?node-id=1-2`
    const ref = parseFigmaUrl(url)!
    const embed = figmaEmbedUrl(ref, url)
    expect(embed.startsWith(`https://embed.figma.com/design/${KEY}/`)).toBe(true)
    expect(embed).toContain("node-id=1%3A2")
    expect(embed).toContain("embed-host=projectproject")
  })

  it("omits node-id when the ref has none", () => {
    const url = `https://figma.com/board/${KEY}/N`
    expect(figmaEmbedUrl(parseFigmaUrl(url)!, url)).not.toContain("node-id")
  })
})

describe("extractFigmaRefs", () => {
  it("finds refs inside markdown links", () => {
    const md = `See [Checkout](https://figma.com/design/${KEY}/Checkout?node-id=1-2) today.`
    expect(extractFigmaRefs(md)).toEqual([
      { kind: "design", fileKey: KEY, nodeId: "1:2", slug: "Checkout" }
    ])
  })

  it("dedupes the same file and node", () => {
    const md = `a https://figma.com/design/${KEY}/A?node-id=1-2 b https://figma.com/design/${KEY}/A?node-id=1-2`
    expect(extractFigmaRefs(md)).toHaveLength(1)
  })

  it("keeps distinct nodes in the same file apart", () => {
    const md = `https://figma.com/design/${KEY}/A?node-id=1-2 https://figma.com/design/${KEY}/A?node-id=3-4`
    expect(extractFigmaRefs(md)).toHaveLength(2)
  })

  it("returns nothing for markdown with no figma links", () => {
    expect(extractFigmaRefs("# Title\n\nSome text.")).toEqual([])
  })
})

describe("figmaRefKey", () => {
  it("distinguishes a file-level ref from a node-level one", () => {
    const file = parseFigmaUrl(`https://figma.com/design/${KEY}/A`)!
    const node = parseFigmaUrl(`https://figma.com/design/${KEY}/A?node-id=1-2`)!
    expect(figmaRefKey(file)).not.toBe(figmaRefKey(node))
  })
})

describe("figmaSrc", () => {
  it("strips pp-density but keeps figma's own params", () => {
    const out = figmaSrc(
      `https://figma.com/design/${KEY}/N?node-id=1-2&pp-density=compact`
    )
    expect(out).toContain("node-id=1-2")
    expect(out).not.toContain("pp-density")
  })

  it("returns unparseable input unchanged", () => {
    expect(figmaSrc("not a url")).toBe("not a url")
  })
})

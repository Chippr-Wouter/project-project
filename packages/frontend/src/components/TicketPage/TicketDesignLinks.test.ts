import { describe, expect, it } from "vite-plus/test"
import { extractTicketDesignLinks } from "./TicketDesignLinks"

const FIGMA_KEY = "AbCdEfGhIjKlMnOp"

describe("extractTicketDesignLinks", () => {
  it("extracts labeled Figma and Paper links in document order", () => {
    const links = extractTicketDesignLinks(
      `[Checkout](https://www.figma.com/design/${FIGMA_KEY}/Checkout?node-id=1-2)\n\n[Flow \\] v2](https://app.paper.design/file/flow)`
    )

    expect(links).toEqual([
      {
        kind: "figma",
        url: `https://www.figma.com/design/${FIGMA_KEY}/Checkout?node-id=1-2`,
        label: "Checkout",
        reference: {
          kind: "design",
          fileKey: FIGMA_KEY,
          nodeId: "1:2",
          slug: "Checkout"
        }
      },
      {
        kind: "paper",
        url: "https://app.paper.design/file/flow",
        label: "Flow ] v2"
      }
    ])
  })

  it("extracts bare links and trims prose punctuation", () => {
    const links = extractTicketDesignLinks(
      `See https://figma.com/board/${FIGMA_KEY}/Planning and https://app.paper.design/file/flow.`
    )

    expect(links.map(({ kind, url }) => ({ kind, url }))).toEqual([
      {
        kind: "figma",
        url: `https://figma.com/board/${FIGMA_KEY}/Planning`
      },
      { kind: "paper", url: "https://app.paper.design/file/flow" }
    ])
  })

  it("deduplicates the same Figma target and Paper URL", () => {
    const links = extractTicketDesignLinks(
      `[Frame](https://figma.com/design/${FIGMA_KEY}/A?node-id=1-2&pp-density=compact)\nhttps://figma.com/design/${FIGMA_KEY}/A?node-id=1-2\n[Paper](https://app.paper.design/file/flow) https://app.paper.design/file/flow`
    )

    expect(links).toHaveLength(2)
    expect(links[0]?.url).toBe(
      `https://figma.com/design/${FIGMA_KEY}/A?node-id=1-2`
    )
  })

  it("ignores lookalike and invalid design URLs", () => {
    expect(
      extractTicketDesignLinks(
        "https://figma.com.evil.test/design/AbCdEfGhIjKlMnOp/A https://app.paper.design.example/file/flow https://app.paper.design/not-a-file/flow"
      )
    ).toEqual([])
  })
})

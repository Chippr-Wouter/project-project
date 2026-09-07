import { afterEach, describe, expect, it } from "vite-plus/test"
import { cleanup, render, screen } from "@testing-library/react"
import {
  ATTACHMENT_TILE_FOOTER_HEIGHT,
  ATTACHMENT_TILE_MIN_WIDTH,
  ATTACHMENT_TILE_PREVIEW_HEIGHT
} from "./AttachmentTile"
import {
  ATTACHMENT_UNAVAILABLE_CHIP_HEIGHT,
  ATTACHMENT_UNAVAILABLE_CHIP_WIDTH,
  AttachmentUnavailable
} from "./AttachmentUnavailable"

afterEach(cleanup)

describe("AttachmentUnavailable", () => {
  it("says the attachment could not be loaded", () => {
    render(<AttachmentUnavailable />)
    expect(
      screen.getByText("This attachment couldn't be loaded.")
    ).toBeDefined()
  })

  it("holds the same slot as the tile it replaces, filename row included", () => {
    render(<AttachmentUnavailable />)
    const element = screen.getByText("This attachment couldn't be loaded.")
    expect(element.style.width).toBe(`${ATTACHMENT_TILE_MIN_WIDTH}px`)
    expect(element.style.height).toBe(
      `${ATTACHMENT_TILE_PREVIEW_HEIGHT + ATTACHMENT_TILE_FOOTER_HEIGHT}px`
    )
  })

  it("fixes both dimensions when collapsed, so the morph never measures a moving target", () => {
    render(<AttachmentUnavailable variant="inline" />)
    const element = screen.getByText("This attachment couldn't be loaded.")
    expect(element.style.height).toBe(`${ATTACHMENT_UNAVAILABLE_CHIP_HEIGHT}px`)
    expect(element.style.width).toBe(`${ATTACHMENT_UNAVAILABLE_CHIP_WIDTH}px`)
  })
})

import { describe, expect, it } from "vite-plus/test"
import {
  PDF_SPREAD_PAGE_HEIGHT,
  PDF_SPREAD_PAGE_WIDTH,
  pdfSpreadScale
} from "./pdfSpreadLayout"

const rasterOf = (page: { width: number; height: number }) => {
  const scale = pdfSpreadScale(page)
  return { width: page.width * scale, height: page.height * scale }
}

const MAX_WIDTH = PDF_SPREAD_PAGE_WIDTH * 2
const MAX_HEIGHT = PDF_SPREAD_PAGE_HEIGHT * 2

describe("pdfSpreadScale", () => {
  it("sizes a landscape page by its width", () => {
    const raster = rasterOf({ width: 842, height: 595 })
    expect(Math.round(raster.width)).toBe(MAX_WIDTH)
    expect(raster.height).toBeLessThanOrEqual(MAX_HEIGHT)
  })

  it("rasters a portrait A4 page well above its rendered width", () => {
    const raster = rasterOf({ width: 595, height: 842 })
    expect(raster.width).toBeGreaterThan(104 * 1.5)
    expect(raster.height).toBeLessThanOrEqual(MAX_HEIGHT)
  })

  it("bounds a very tall page by height instead of width", () => {
    const raster = rasterOf({ width: 200, height: 10000 })
    expect(Math.round(raster.height)).toBe(MAX_HEIGHT)
    expect(raster.width).toBeLessThan(MAX_WIDTH)
  })

  it("keeps every raster inside both bounds across extreme aspect ratios", () => {
    const pages = [
      { width: 1, height: 20000 },
      { width: 20000, height: 1 },
      { width: 595, height: 842 },
      { width: 842, height: 595 },
      { width: 3000, height: 3000 }
    ]
    for (const page of pages) {
      const raster = rasterOf(page)
      expect(raster.width).toBeLessThanOrEqual(MAX_WIDTH + 0.001)
      expect(raster.height).toBeLessThanOrEqual(MAX_HEIGHT + 0.001)
    }
  })

  it("preserves the page aspect ratio", () => {
    const page = { width: 200, height: 10000 }
    const raster = rasterOf(page)
    expect(raster.width / raster.height).toBeCloseTo(
      page.width / page.height,
      6
    )
  })

  it("falls back to a fixed scale for a degenerate viewport", () => {
    expect(pdfSpreadScale({ width: 0, height: 0 })).toBeGreaterThan(0)
  })
})

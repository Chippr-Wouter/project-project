import { describe, expect, it } from "vite-plus/test"
import { pageCount, pageWindow, pageRange } from "./paging"

describe("pageCount", () => {
  it("counts a partial page as a page", () => {
    expect(pageCount(27, 50)).toBe(1)
  })

  it("counts an exact multiple without a trailing empty page", () => {
    expect(pageCount(100, 50)).toBe(2)
  })

  it("shows a single page when there is nothing", () => {
    expect(pageCount(0, 50)).toBe(1)
  })
})

describe("pageRange", () => {
  it("describes the first page", () => {
    expect(pageRange({ page: 1, pageSize: 50, total: 217 })).toEqual({
      from: 1,
      to: 50
    })
  })

  it("stops the last page at the total", () => {
    expect(pageRange({ page: 5, pageSize: 50, total: 217 })).toEqual({
      from: 201,
      to: 217
    })
  })

  it("collapses to zero when there is nothing", () => {
    expect(pageRange({ page: 1, pageSize: 50, total: 0 })).toEqual({
      from: 0,
      to: 0
    })
  })
})

describe("pageWindow", () => {
  it("lists every page when they all fit", () => {
    expect(pageWindow({ page: 1, pages: 5, span: 7 })).toEqual([1, 2, 3, 4, 5])
  })

  it("keeps the first and last page anchored when it must elide", () => {
    const window = pageWindow({ page: 10, pages: 20, span: 7 })
    expect(window[0]).toBe(1)
    expect(window[window.length - 1]).toBe(20)
  })

  it("elides with gaps on both sides of a middle page", () => {
    expect(pageWindow({ page: 10, pages: 20, span: 7 })).toEqual([
      1,
      "gap",
      9,
      10,
      11,
      "gap",
      20
    ])
  })

  it("elides only on the right while near the start", () => {
    expect(pageWindow({ page: 2, pages: 20, span: 7 })).toEqual([
      1,
      2,
      3,
      4,
      5,
      "gap",
      20
    ])
  })

  it("elides only on the left while near the end", () => {
    expect(pageWindow({ page: 19, pages: 20, span: 7 })).toEqual([
      1,
      "gap",
      16,
      17,
      18,
      19,
      20
    ])
  })

  it("never exceeds the span", () => {
    for (let page = 1; page <= 20; page++) {
      expect(
        pageWindow({ page, pages: 20, span: 7 }).length
      ).toBeLessThanOrEqual(7)
    }
  })

  it("is a single page when there is only one", () => {
    expect(pageWindow({ page: 1, pages: 1, span: 7 })).toEqual([1])
  })
})

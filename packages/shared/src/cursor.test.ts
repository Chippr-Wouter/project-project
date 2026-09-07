import { describe, expect, it } from "vite-plus/test"
import { padNumericIdSort, paginateSorted, tryDecodeCursor } from "./cursor"
import { decodeCursor, encodeCursor } from "./Pagination"

describe("cursor helpers", () => {
  it("pads numeric ids to 10 chars", () => {
    expect(padNumericIdSort("T-1")).toBe("0000000001")
    expect(padNumericIdSort("FOO-1")).toBe("0000000001")
    expect(padNumericIdSort("A1B2-42")).toBe("0000000042")
    expect(padNumericIdSort("FOO-BAR-7")).toBe("0000000007")
    expect(padNumericIdSort("G-42")).toBe("0000000042")
    expect(padNumericIdSort("T-1234567890")).toBe("1234567890")
  })

  it("falls back to undefined for non-numeric ids", () => {
    expect(padNumericIdSort("not-numeric")).toBe(undefined)
  })

  it("tryDecodeCursor returns payload for a valid cursor", () => {
    const c = encodeCursor({ id: "T-7", sort: "0000000007" })
    expect(tryDecodeCursor(c)).toEqual({ id: "T-7", sort: "0000000007" })
  })

  it("tryDecodeCursor returns undefined for garbage", () => {
    expect(tryDecodeCursor("not-base64-or-json")).toBe(undefined)
    expect(tryDecodeCursor(undefined)).toBe(undefined)
  })
})

interface Row {
  readonly id: string
}
const row = (n: number): Row => ({ id: `T-${n}` })
const opts = (cursor?: ReturnType<typeof decodeCursor>) => ({
  cursor,
  limit: 3,
  sortKey: (r: Row) => padNumericIdSort(r.id)!,
  id: (r: Row) => r.id
})

describe("paginateSorted", () => {
  const all = [row(1), row(2), row(3), row(4), row(5)]

  it("returns the first page and a cursor when there is more", () => {
    const page = paginateSorted(all, opts())
    expect(page.items.map((r) => r.id)).toEqual(["T-1", "T-2", "T-3"])
    expect(page.nextCursor).not.toBeNull()
    expect(decodeCursor(page.nextCursor!)).toEqual({
      id: "T-3",
      sort: "0000000003"
    })
  })

  it("returns the remainder and a null cursor when items fit exactly", () => {
    const page1 = paginateSorted(all, opts())
    const page2 = paginateSorted(all, opts(decodeCursor(page1.nextCursor!)))
    expect(page2.items.map((r) => r.id)).toEqual(["T-4", "T-5"])
    expect(page2.nextCursor).toBeNull()
  })

  it("returns null cursor when exactly `limit` items remain on the first page", () => {
    const exact = [row(1), row(2), row(3)]
    const page = paginateSorted(exact, opts())
    expect(page.items).toHaveLength(3)
    expect(page.nextCursor).toBeNull()
  })

  it("returns an empty page and null cursor when the source is empty", () => {
    const page = paginateSorted<Row>([], opts())
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it("returns an empty page when the cursor is past the last item", () => {
    const page = paginateSorted(all, opts({ id: "T-5", sort: "0000000005" }))
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  })

  it("walks descending arrays when dir is 'desc'", () => {
    const desc = [row(5), row(4), row(3), row(2), row(1)]
    const page1 = paginateSorted(desc, {
      cursor: undefined,
      limit: 3,
      sortKey: (r) => padNumericIdSort(r.id)!,
      id: (r) => r.id,
      dir: "desc"
    })
    expect(page1.items.map((r) => r.id)).toEqual(["T-5", "T-4", "T-3"])
    expect(page1.nextCursor).not.toBeNull()

    const page2 = paginateSorted(desc, {
      cursor: decodeCursor(page1.nextCursor!),
      limit: 3,
      sortKey: (r) => padNumericIdSort(r.id)!,
      id: (r) => r.id,
      dir: "desc"
    })
    expect(page2.items.map((r) => r.id)).toEqual(["T-2", "T-1"])
    expect(page2.nextCursor).toBeNull()
  })
})

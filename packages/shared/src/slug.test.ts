import { describe, expect, it } from "vite-plus/test"
import { BASELINE_STATUS_SLUGS } from "./schemas/Status"
import { deriveStatusSlug, isReservedStatusSlug } from "./slug"

describe("deriveStatusSlug", () => {
  it("lowercases and underscores spaces", () => {
    expect(deriveStatusSlug("In review")).toBe("in_review")
  })

  it("strips punctuation", () => {
    expect(deriveStatusSlug("Won't fix!")).toBe("wont_fix")
  })

  it("NFKD-normalizes diacritics", () => {
    expect(deriveStatusSlug("à la mode")).toBe("a_la_mode")
    expect(deriveStatusSlug("Düsseldorf")).toBe("dusseldorf")
  })

  it("strips emoji and surrounding whitespace", () => {
    expect(deriveStatusSlug("  🚀 Shipped  ")).toBe("shipped")
  })

  it("collapses repeated whitespace", () => {
    expect(deriveStatusSlug("a    b")).toBe("a_b")
  })

  it("trims trailing underscores after stripping", () => {
    expect(deriveStatusSlug("Hello!!!")).toBe("hello")
  })

  it("returns empty string on all-non-Latin input", () => {
    expect(deriveStatusSlug("中文")).toBe("")
  })

  it("returns empty string on empty input", () => {
    expect(deriveStatusSlug("")).toBe("")
    expect(deriveStatusSlug("   ")).toBe("")
  })
})

describe("isReservedStatusSlug", () => {
  it("rejects baseline slugs", () => {
    for (const s of BASELINE_STATUS_SLUGS) {
      expect(isReservedStatusSlug(s)).toBe(true)
    }
  })

  it("accepts arbitrary user slugs", () => {
    expect(isReservedStatusSlug("in_review")).toBe(false)
    expect(isReservedStatusSlug("blocked")).toBe(false)
  })
})

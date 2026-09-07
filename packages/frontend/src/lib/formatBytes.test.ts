import { describe, expect, it } from "vite-plus/test"
import { formatBytes } from "./formatBytes"

describe("formatBytes", () => {
  it("shows an empty object as zero bytes", () => {
    expect(formatBytes(0, "en-US")).toBe("0 B")
  })

  it("keeps sub-kilobyte sizes in bytes", () => {
    expect(formatBytes(512, "en-US")).toBe("512 B")
  })

  it("steps up at the kilobyte boundary", () => {
    expect(formatBytes(1024, "en-US")).toBe("1 KB")
  })

  it("keeps one fractional digit so a 1.5 KB file is not rounded to 2", () => {
    expect(formatBytes(1536, "en-US")).toBe("1.5 KB")
  })

  it("drops a trailing zero fraction", () => {
    expect(formatBytes(2 * 1024 * 1024, "en-US")).toBe("2 MB")
  })

  it("reads the attachment cap as megabytes", () => {
    expect(formatBytes(25 * 1024 * 1024, "en-US")).toBe("25 MB")
  })

  it("steps up at the gigabyte boundary", () => {
    expect(formatBytes(1024 * 1024 * 1024, "en-US")).toBe("1 GB")
  })

  it("formats the fraction in the active locale", () => {
    expect(formatBytes(1536, "nl-NL")).toBe("1,5 KB")
  })
})

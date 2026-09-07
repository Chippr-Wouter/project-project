import { describe, expect, it } from "vite-plus/test"
import { safeInternalPath } from "./safeRedirect"

describe("safeInternalPath", () => {
  it("keeps a plain internal path", () => {
    expect(safeInternalPath("/invite/abc-123")).toBe("/invite/abc-123")
  })

  it("keeps an internal path with a query string", () => {
    expect(safeInternalPath("/orgs/acme?tab=members")).toBe(
      "/orgs/acme?tab=members"
    )
  })

  it("falls back for non-string input", () => {
    expect(safeInternalPath(undefined)).toBe("/")
    expect(safeInternalPath(42)).toBe("/")
  })

  it("rejects protocol-relative paths", () => {
    expect(safeInternalPath("//evil.example.com")).toBe("/")
  })

  it("rejects absolute urls", () => {
    expect(safeInternalPath("https://evil.example.com")).toBe("/")
  })

  it("rejects backslash escapes", () => {
    expect(safeInternalPath("/\\evil.example.com")).toBe("/")
  })

  it("rejects whitespace and control characters", () => {
    expect(safeInternalPath("/foo bar")).toBe("/")
    expect(safeInternalPath("/foo\nbar")).toBe("/")
    expect(safeInternalPath("/foo\tbar")).toBe("/")
  })

  it("honors a custom fallback", () => {
    expect(safeInternalPath("nope", "/welcome")).toBe("/welcome")
  })
})

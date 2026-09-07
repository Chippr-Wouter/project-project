import { describe, expect, it } from "vite-plus/test"
import {
  extractMentionLinks,
  formatMentionHref,
  MENTION_SCHEME,
  parseMentionHref
} from "./mentions"

describe("formatMentionHref", () => {
  it("formats user mentions", () => {
    expect(formatMentionHref("user", "github_42")).toBe(
      "mention:user/github_42"
    )
  })
  it("formats ticket mentions", () => {
    expect(formatMentionHref("ticket", "T-12")).toBe("mention:ticket/T-12")
    expect(formatMentionHref("ticket", "FOO-12")).toBe("mention:ticket/FOO-12")
  })
})

describe("parseMentionHref", () => {
  it("parses user mentions", () => {
    expect(parseMentionHref("mention:user/github_42")).toEqual({
      type: "user",
      id: "github_42"
    })
  })
  it("parses ticket mentions", () => {
    expect(parseMentionHref("mention:ticket/T-12")).toEqual({
      type: "ticket",
      id: "T-12"
    })
    expect(parseMentionHref("mention:ticket/FOO-12")).toEqual({
      type: "ticket",
      id: "FOO-12"
    })
  })
  it("returns null for non-mention hrefs", () => {
    expect(parseMentionHref("https://example.com")).toBeNull()
    expect(parseMentionHref("mailto:a@b.com")).toBeNull()
    expect(parseMentionHref("")).toBeNull()
  })
  it("returns null for unknown mention types", () => {
    expect(parseMentionHref("mention:doc/foo")).toBeNull()
    expect(parseMentionHref("mention:foo/bar")).toBeNull()
  })
  it("returns null for malformed mention hrefs", () => {
    expect(parseMentionHref("mention:user")).toBeNull()
    expect(parseMentionHref("mention:user/")).toBeNull()
    expect(parseMentionHref("mention:/foo")).toBeNull()
  })
  it("round-trips for every registered type", () => {
    const cases = [
      ["user", "github_42"],
      ["ticket", "FOO-1"]
    ] as const
    for (const [type, id] of cases) {
      expect(parseMentionHref(formatMentionHref(type, id))).toEqual({
        type,
        id
      })
    }
  })
})

it("MENTION_SCHEME is the literal 'mention:'", () => {
  expect(MENTION_SCHEME).toBe("mention:")
})

describe("extractMentionLinks", () => {
  it("picks up well-formed user and ticket links", () => {
    const body =
      "See [Wouter](mention:user/abc) and [Bug](mention:ticket/T-7) for context."
    const links = extractMentionLinks(body)
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({
      label: "Wouter",
      href: "mention:user/abc",
      parsed: { type: "user", id: "abc" }
    })
    expect(links[1].parsed).toEqual({ type: "ticket", id: "T-7" })
  })

  it("flags malformed mention hrefs (parsed: null)", () => {
    const body = "Bad [x](mention:user/) and [y](mention:doc/foo)"
    const links = extractMentionLinks(body)
    expect(links).toHaveLength(2)
    expect(links.every((l) => l.parsed === null)).toBe(true)
  })

  it("ignores non-mention links", () => {
    const body = "See [docs](https://example.com) and [home](/page)"
    expect(extractMentionLinks(body)).toHaveLength(0)
  })

  it("captures empty labels (so the caller can reject them)", () => {
    const links = extractMentionLinks("[](mention:user/abc)")
    expect(links).toEqual([
      {
        label: "",
        href: "mention:user/abc",
        parsed: { type: "user", id: "abc" }
      }
    ])
  })
})

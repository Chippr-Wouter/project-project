import * as DateTime from "effect/DateTime"
import { describe, expect, it } from "vite-plus/test"
import type { CommentBlock } from "./comments-region"
import {
  COMMENTS_END,
  COMMENTS_START,
  parseCommentsRegion,
  serializeCommentsRegion,
  splitDescriptionAndCommentsRegion,
  validateCommentBody
} from "./comments-region"

const isoDate = (s: string) => DateTime.toDate(DateTime.makeUnsafe(s))

const sample = (): ReadonlyArray<CommentBlock> => [
  {
    id: "c_a",
    author: "github_42",
    createdAt: isoDate("2026-05-07T10:00:00.000Z"),
    editedAt: isoDate("2026-05-07T10:04:00.000Z"),
    body: "Looks good. cc [Wouter](mention:user/github_88)."
  },
  {
    id: "c_b",
    author: "github_88",
    createdAt: isoDate("2026-05-07T10:06:00.000Z"),
    editedAt: null,
    body: "Yep, on it.\n\nMore details below:\n\n---\n\nA section."
  }
]

describe("splitDescriptionAndCommentsRegion", () => {
  it("returns full body and empty region when no markers", () => {
    const { description, region } = splitDescriptionAndCommentsRegion(
      "# Title\n\nBody text.\n"
    )
    expect(description).toBe("# Title\n\nBody text.\n")
    expect(region).toBe("")
  })

  it("splits at COMMENTS_START", () => {
    const body = `# Title\n\nDescription.\n\n${COMMENTS_START}\nstuff\n${COMMENTS_END}\n`
    const { description, region } = splitDescriptionAndCommentsRegion(body)
    expect(description).toBe("# Title\n\nDescription.\n\n")
    expect(region).toBe(`${COMMENTS_START}\nstuff\n${COMMENTS_END}\n`)
  })

  it("trims trailing whitespace before the marker so re-serialization is stable", () => {
    const body = `# Title\n\nDescription.\n\n\n\n${COMMENTS_START}\n${COMMENTS_END}\n`
    const { description } = splitDescriptionAndCommentsRegion(body)
    expect(description).toBe("# Title\n\nDescription.\n")
  })
})

describe("serializeCommentsRegion + parseCommentsRegion", () => {
  it("round-trips an empty list to the empty string", () => {
    expect(serializeCommentsRegion([])).toBe("")
    expect(parseCommentsRegion("")).toEqual([])
  })

  it("round-trips multiple comments byte-equal", () => {
    const blocks = sample()
    const serialized = serializeCommentsRegion(blocks)
    expect(serialized.startsWith(COMMENTS_START)).toBe(true)
    expect(serialized.trimEnd().endsWith(COMMENTS_END)).toBe(true)
    expect(parseCommentsRegion(serialized)).toEqual(blocks)
  })

  it("parses a region containing tombstone-style whitespace tolerantly", () => {
    const region = `${COMMENTS_START}\n<!-- comment:c_a -->\n---\nauthor: github_42\ncreatedAt: 2026-05-07T10:00:00.000Z\n---\nHello.\n${COMMENTS_END}\n`
    const parsed = parseCommentsRegion(region)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe("c_a")
    expect(parsed[0].editedAt).toBeNull()
  })

  it("ignores unknown text inside the region (does not crash)", () => {
    const region = `${COMMENTS_START}\nstray text that nobody wrote\n${COMMENTS_END}\n`
    expect(parseCommentsRegion(region)).toEqual([])
  })

  it("preserves bodies that contain '---'", () => {
    const blocks = sample()
    const round = parseCommentsRegion(serializeCommentsRegion(blocks))
    expect(round[1].body).toBe(blocks[1].body)
  })
})

describe("validateCommentBody", () => {
  it("accepts normal markdown", () => {
    expect(validateCommentBody("Hello\n\n```ts\nlet x = 1\n```").ok).toBe(true)
  })
  it("rejects bodies containing the comments marker pattern", () => {
    expect(validateCommentBody("hi <!-- comment:fake -->").ok).toBe(false)
    expect(validateCommentBody("hi <!--   comment:fake -->").ok).toBe(false)
    expect(validateCommentBody("<!-- comments:start -->").ok).toBe(false)
    expect(validateCommentBody("<!-- comments:end -->").ok).toBe(false)
  })
  it("rejects empty bodies", () => {
    expect(validateCommentBody("").ok).toBe(false)
    expect(validateCommentBody("   \n  ").ok).toBe(false)
  })
})

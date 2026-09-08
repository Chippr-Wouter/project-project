import { describe, expect, it } from "vite-plus/test"
import { branchMentionsTicketId, ticketIdsInBranch } from "./branchTicketId"

const idsFor = (branches: ReadonlyArray<string>) =>
  Object.fromEntries(
    branches.map((branch) => [branch, [...ticketIdsInBranch(branch)]])
  )

const noIds = (branches: ReadonlyArray<string>) =>
  Object.fromEntries(branches.map((branch) => [branch, []]))

describe("ticketIdsInBranch", () => {
  it("extracts an id regardless of the case it was written in", () => {
    expect(
      idsFor([
        "feat/PP-18-test",
        "feat/pp-18-test",
        "Pp-18/test",
        "feat/oh-18/test",
        "Oh-18/test(chore)"
      ])
    ).toEqual({
      "feat/PP-18-test": ["PP-18"],
      "feat/pp-18-test": ["PP-18"],
      "Pp-18/test": ["PP-18"],
      "feat/oh-18/test": ["OH-18"],
      "Oh-18/test(chore)": ["OH-18"]
    })
  })

  it("accepts any non-alphanumeric character as a token boundary", () => {
    expect(
      idsFor([
        "PP-18",
        "PP-18/test(chore)",
        "feat/PP-18/test",
        "feat/PP-18.hotfix",
        "feat/PP-18_wip",
        "release/v2/PP-18"
      ])
    ).toEqual({
      "PP-18": ["PP-18"],
      "PP-18/test(chore)": ["PP-18"],
      "feat/PP-18/test": ["PP-18"],
      "feat/PP-18.hotfix": ["PP-18"],
      "feat/PP-18_wip": ["PP-18"],
      "release/v2/PP-18": ["PP-18"]
    })
  })

  it("rejects ids fused to an adjacent letter or digit", () => {
    expect(idsFor(["feat/PP-18abc", "feat/1PP-18"])).toEqual(
      noIds(["feat/PP-18abc", "feat/1PP-18"])
    )
  })

  it("reads a fused key or number as a different ticket, never the shorter one", () => {
    expect(idsFor(["feat/XPP-18", "feat/PP-183", "chore/ohio-18-fix"])).toEqual(
      {
        "feat/XPP-18": ["XPP-18"],
        "feat/PP-183": ["PP-183"],
        "chore/ohio-18-fix": ["OHIO-18"]
      }
    )
  })

  it("rejects malformed ids", () => {
    const branches = [
      "feat/PP-018",
      "feat/PP-0",
      "feat/PP-",
      "feat/-18",
      "feat/PP18",
      "feat/T-05-T-06-url"
    ]
    expect(idsFor(branches)).toEqual(noIds(branches))
  })

  it("rejects keys longer than ten characters", () => {
    expect(idsFor(["feat/ABCDEFGHIJK-1", "feat/ABCDEFGHIJ-1"])).toEqual({
      "feat/ABCDEFGHIJK-1": [],
      "feat/ABCDEFGHIJ-1": ["ABCDEFGHIJ-1"]
    })
  })

  it("treats non-ascii letters as boundary-breaking", () => {
    expect(idsFor(["feat/PP-18é", "féat/PP-18"])).toEqual({
      "feat/PP-18é": [],
      "féat/PP-18": ["PP-18"]
    })
  })

  it("returns nothing for branches that carry no id", () => {
    const branches = [
      "main",
      "chore/ticket-hover-cards",
      "fix/oauth-consent-errors",
      "docs/strict-orthogonal-roles",
      "claude/alchemy-deployment-integration-mc1w67"
    ]
    expect(idsFor(branches)).toEqual(noIds(branches))
  })

  it("collects every distinct id and collapses case variants of one id", () => {
    expect(
      idsFor(["feat/PP-18-and-UNKNOWN-9", "feat/PP-18-and-pp-18"])
    ).toEqual({
      "feat/PP-18-and-UNKNOWN-9": ["PP-18", "UNKNOWN-9"],
      "feat/PP-18-and-pp-18": ["PP-18"]
    })
  })
})

describe("branchMentionsTicketId", () => {
  it("is true only when a well-formed id is present", () => {
    expect(
      Object.fromEntries(
        [
          "feat/pp-18-test",
          "revert-45-fix/dirty-dashboard-navigation",
          "feat/PP-018",
          "chore/ticket-hover-cards",
          "main"
        ].map((branch) => [branch, branchMentionsTicketId(branch)])
      )
    ).toEqual({
      "feat/pp-18-test": true,
      "revert-45-fix/dirty-dashboard-navigation": true,
      "feat/PP-018": false,
      "chore/ticket-hover-cards": false,
      main: false
    })
  })
})

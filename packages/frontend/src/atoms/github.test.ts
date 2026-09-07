import { describe, expect, it } from "vite-plus/test"
import * as Schema from "effect/Schema"
import { StatusSlug } from "@projectproject/shared"
import { branchesKey, shouldInvalidateTicketsForGitStates } from "./github"

const s = Schema.decodeUnknownSync(StatusSlug)

describe("branchesKey", () => {
  it("separates branch caches by connected repo", () => {
    expect(branchesKey("org", "project", "repo-a", "main")).not.toBe(
      branchesKey("org", "project", "repo-b", "main")
    )
  })

  it("is stable for the same project, repo, and query", () => {
    expect(branchesKey("org", "project", "repo-a", "main")).toBe(
      branchesKey("org", "project", "repo-a", "main")
    )
  })
})

describe("shouldInvalidateTicketsForGitStates", () => {
  it("ignores git-state responses without ticket transitions", () => {
    expect(shouldInvalidateTicketsForGitStates({ transitioned: [] })).toBe(
      false
    )
  })

  it("invalidates when a git-state response transitioned tickets", () => {
    expect(
      shouldInvalidateTicketsForGitStates({
        transitioned: [
          {
            ticketId: "T-1",
            fromStatus: s("in_progress"),
            toStatus: s("done"),
            prNumber: 80
          }
        ]
      })
    ).toBe(true)
  })
})

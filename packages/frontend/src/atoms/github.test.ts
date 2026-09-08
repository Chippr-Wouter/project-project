import { describe, expect, it } from "vite-plus/test"
import * as Schema from "effect/Schema"
import { StatusSlug } from "@projectproject/shared"
import {
  branchesKey,
  changedGitStateTicketIds,
  mergeStaleGitStateDetails,
  shouldInvalidateTicketsForGitStates
} from "./github"

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

  it("invalidates when git-state responses report changed tickets", () => {
    expect(
      shouldInvalidateTicketsForGitStates({
        transitioned: [],
        changedTicketIds: ["T-2"]
      })
    ).toBe(true)
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

describe("mergeStaleGitStateDetails", () => {
  const previous = {
    states: {
      "T-1": {
        tag: "pr_open" as const,
        branch: "feat/T-1",
        baseBranch: "main",
        number: 80,
        url: "https://github.com/acme/app/pull/80",
        draft: false,
        title: "Keep details",
        checks: "failing" as const
      }
    },
    transitioned: [],
    tokenStatus: "ok" as const,
    repoStatus: "ok" as const,
    refreshStatus: "fresh" as const
  }

  it("keeps matching PR summaries when a stale response omits them", () => {
    const prWithoutSummary = {
      tag: "pr_open" as const,
      branch: "feat/T-1",
      baseBranch: "main",
      number: 80,
      url: "https://github.com/acme/app/pull/80",
      draft: false,
      title: "",
      checks: "none" as const
    }
    const merged = mergeStaleGitStateDetails(
      previous,
      {
        ...previous,
        states: { "T-1": prWithoutSummary },
        refreshStatus: "stale"
      },
      false
    )

    expect(merged.states["T-1"]).toMatchObject({
      title: "Keep details",
      checks: "failing"
    })
  })

  it("keeps a matching PR while stale data falls back to branch pending", () => {
    const merged = mergeStaleGitStateDetails(
      previous,
      {
        ...previous,
        states: {
          "T-1": {
            tag: "branch_pending",
            name: "feat/T-1",
            baseBranch: "main"
          }
        },
        refreshStatus: "stale"
      },
      false
    )

    expect(merged.states["T-1"]).toEqual(previous.states["T-1"])
  })

  it("clears previous PR details when the repository changes", () => {
    const next = {
      ...previous,
      states: {},
      refreshStatus: "stale" as const
    }
    expect(mergeStaleGitStateDetails(previous, next, true)).toEqual(next)
  })

  it("clears stale details when a fresh response omits them", () => {
    const next = {
      ...previous,
      states: {
        "T-1": {
          tag: "pr_open" as const,
          branch: "feat/T-1",
          baseBranch: "main",
          number: 80,
          url: "https://github.com/acme/app/pull/80",
          draft: false,
          title: "",
          checks: "none" as const
        }
      },
      refreshStatus: "fresh" as const
    }
    expect(mergeStaleGitStateDetails(previous, next, false)).toEqual(next)
  })
})

describe("changedGitStateTicketIds", () => {
  it("detects webhook-driven state changes without server change lists", () => {
    const before = {
      states: {
        "T-1": {
          tag: "pr_open" as const,
          branch: "feat/T-1",
          baseBranch: "main",
          number: 80,
          url: "https://github.com/acme/app/pull/80",
          draft: false,
          title: "Feature",
          checks: "passing" as const
        }
      },
      transitioned: [],
      tokenStatus: "ok" as const,
      repoStatus: "ok" as const
    }
    const after = {
      ...before,
      states: {
        "T-1": {
          tag: "pr_merged" as const,
          branch: "feat/T-1",
          baseBranch: "main",
          number: 80,
          url: "https://github.com/acme/app/pull/80",
          title: "Feature",
          mergedAt: null
        }
      }
    }
    expect(changedGitStateTicketIds(before, after)).toEqual(["T-1"])
  })

  it("does not invalidate for a checks-only update", () => {
    const state = {
      tag: "pr_open" as const,
      branch: "feat/T-1",
      baseBranch: "main",
      number: 80,
      url: "https://github.com/acme/app/pull/80",
      draft: false,
      title: "Feature",
      checks: "passing" as const
    }
    const before = {
      states: { "T-1": state },
      transitioned: [],
      tokenStatus: "ok" as const,
      repoStatus: "ok" as const
    }
    expect(
      changedGitStateTicketIds(before, {
        ...before,
        states: { "T-1": { ...state, checks: "failing" as const } }
      })
    ).toEqual([])
  })
})

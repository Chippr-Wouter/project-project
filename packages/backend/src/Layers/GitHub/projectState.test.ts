import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { GitHubError } from "@projectproject/shared"
import * as GitHubRequest from "./request"

const { graphql } = vi.hoisted(() => ({
  graphql:
    vi.fn<
      (query: string, variables: Record<string, unknown>) => Promise<unknown>
    >()
}))

vi.mock("./clients", () => ({
  graphqlFor: () => graphql
}))

import {
  buildProjectStateBatchQuery,
  fetchProjectStatesWithToken,
  projectStatesFromBatchResponses
} from "./projectState"

const run = <A, E>(
  effect: Effect.Effect<A, E, GitHubRequest.GitHubRequestState>
) => Effect.runPromise(effect.pipe(Effect.provide(GitHubRequest.layer)))

const pr = (
  branch: string,
  state: "OPEN" | "CLOSED" | "MERGED" = "OPEN",
  checkState: string | null = "SUCCESS",
  number = 42
) => ({
  number,
  title: branch,
  url: `https://github.test/acme/app/pull/${branch}`,
  state,
  isDraft: false,
  headRefName: branch,
  baseRefName: "main",
  headRepository: { id: "repo-1" },
  baseRepository: { id: "repo-1" },
  mergedAt: null,
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: checkState ? { state: checkState } : null
        }
      }
    ]
  }
})

describe("projectState", () => {
  afterEach(() => {
    graphql.mockReset()
  })

  it("preserves decode causes in memory without exposing them in encoded errors", () => {
    const cause = new Error("secret wire payload")
    const error = GitHubError.invalidResponse("fetchProjectStateBatch", cause)

    expect(error.cause).toBe(cause)
    expect(JSON.stringify(error)).not.toContain("secret wire payload")
    expect(Schema.encodeUnknownSync(GitHubError)(error)).toEqual({
      _tag: "GitHubError",
      message: "GitHub returned an invalid pull-request page"
    })
  })

  it("builds a branch-state query with stable aliases and variables", () => {
    const batch = buildProjectStateBatchQuery(["feat/T-1", "bug/T-2"])

    expect(batch.variables).toEqual({
      ref0: "refs/heads/feat/T-1",
      headRefName0: "feat/T-1",
      ref1: "refs/heads/bug/T-2",
      headRefName1: "bug/T-2"
    })
    expect(batch.query).toContain("b0: ref(qualifiedName: $ref0)")
    expect(batch.query).toContain("p0: pullRequests(")
    expect(batch.query).toContain("first: 100")
    expect(batch.query).toContain("b1: ref(qualifiedName: $ref1)")
    expect(batch.query).toContain("p1: pullRequests(")
    expect(batch.query).toContain("$headRefName1: String!")
  })

  it("adds a cursor when continuing a branch-state page", () => {
    const batch = buildProjectStateBatchQuery(
      ["feat/T-1"],
      new Map([["feat/T-1", "cursor-1"]])
    )

    expect(batch.variables).toEqual({
      ref0: "refs/heads/feat/T-1",
      headRefName0: "feat/T-1",
      cursor0: "cursor-1"
    })
    expect(batch.query).toContain("$cursor0: String")
    expect(batch.query).toContain("after: $cursor0")
  })

  it("continues past fork PRs until it finds a same-repository open PR", async () => {
    graphql
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          b0: { name: "feat/T-5" },
          p0: {
            nodes: [{ ...pr("feat/T-5"), headRepository: { id: "fork" } }],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          p0: {
            nodes: [pr("feat/T-5")],
            pageInfo: { hasNextPage: false, endCursor: "cursor-2" }
          }
        }
      })

    const states = await run(
      fetchProjectStatesWithToken(
        "token",
        "acme",
        "app",
        ["feat/T-5"],
        "installation"
      )
    )

    expect(states.prByBranch.get("feat/T-5")?.state).toBe("open")
    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[1]?.[1]).toMatchObject({ cursor0: "cursor-1" })
  })

  it("fails when GitHub signals another page without a cursor", async () => {
    graphql.mockResolvedValueOnce({
      repository: {
        defaultBranchRef: { name: "main" },
        p0: {
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: null }
        }
      }
    })

    const error = await run(
      Effect.flip(
        fetchProjectStatesWithToken(
          "token",
          "acme",
          "app",
          ["feat/T-6"],
          "installation"
        )
      )
    )

    expect(error._tag).toBe("GitHubError")
  })

  it("fails when a continuation loses the repository", async () => {
    graphql
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          p0: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" }
          }
        }
      })
      .mockResolvedValueOnce({ repository: null })

    const error = await run(
      Effect.flip(
        fetchProjectStatesWithToken(
          "token",
          "acme",
          "app",
          ["feat/T-7"],
          "installation"
        )
      )
    )

    expect(error._tag).toBe("RepoGone")
  })

  it("fails when a pull-request date is malformed", async () => {
    graphql.mockResolvedValueOnce({
      repository: {
        defaultBranchRef: { name: "main" },
        p0: {
          nodes: [{ ...pr("feat/T-8"), mergedAt: "not-a-date" }],
          pageInfo: { hasNextPage: false, endCursor: null }
        }
      }
    })

    const error = await run(
      Effect.flip(
        fetchProjectStatesWithToken(
          "token",
          "acme",
          "app",
          ["feat/T-8"],
          "installation"
        )
      )
    )

    expect(error._tag).toBe("GitHubError")
    if (error._tag === "GitHubError") {
      expect(Object.getOwnPropertyDescriptor(error, "operation")?.value).toBe(
        "fetchProjectStateBatch"
      )
      expect(error.cause).toBeDefined()
    }
  })

  it("fetches the default branch even when no ticket has an attached branch", async () => {
    graphql.mockResolvedValueOnce({
      repository: { defaultBranchRef: { name: "trunk" } }
    })
    const states = await run(
      fetchProjectStatesWithToken("token", "acme", "app", [], "installation")
    )
    expect(states.defaultBranch).toBe("trunk")
    expect(states.prByBranch.size).toBe(0)
    expect(graphql).toHaveBeenCalledTimes(1)
    expect(graphql.mock.calls[0]?.[0]).not.toContain("DiscoverBranches")
  })

  it("discovers matching branches across pages and unions them with explicit branches", async () => {
    graphql
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          refs: {
            nodes: [{ name: "main" }, { name: "PP-T-1" }],
            pageInfo: { hasNextPage: true, endCursor: "branch-cursor-1" }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          refs: {
            nodes: [{ name: "PP-T-2" }],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          b0: { name: "feature/explicit" },
          p0: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          b1: { name: "PP-T-1" },
          p1: {
            nodes: [pr("PP-T-1")],
            pageInfo: { hasNextPage: false, endCursor: null }
          },
          b2: { name: "PP-T-2" },
          p2: {
            nodes: [pr("PP-T-2", "MERGED")],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })

    const states = await run(
      fetchProjectStatesWithToken(
        "token",
        "acme",
        "app",
        ["feature/explicit"],
        "installation",
        "PP-"
      )
    )

    expect([...states.existingBranches]).toEqual([
      "feature/explicit",
      "PP-T-1",
      "PP-T-2"
    ])
    expect(states.prByBranch.get("PP-T-1")?.state).toBe("open")
    expect(states.prByBranch.get("PP-T-2")?.state).toBe("merged")
    expect(graphql).toHaveBeenCalledTimes(3)
    expect(graphql.mock.calls[0]?.[1]).toMatchObject({
      owner: "acme",
      name: "app",
      q: "PP-",
      after: null
    })
    expect(graphql.mock.calls[1]?.[1]).toMatchObject({
      q: "PP-",
      after: "branch-cursor-1"
    })
    expect(graphql.mock.calls[0]?.[0]).toContain(
      "repository(owner: $owner, name: $name)"
    )
  })

  it("drops discovered branches that carry no ticket id", async () => {
    graphql
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          refs: {
            nodes: [
              { name: "main" },
              { name: "feat/pp-18-lowercase" },
              { name: "chore/ticket-hover-cards" },
              { name: "fix/oauth-consent-errors" }
            ],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          b0: { name: "feat/pp-18-lowercase" },
          p0: {
            nodes: [pr("feat/pp-18-lowercase")],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })

    const states = await run(
      fetchProjectStatesWithToken(
        "token",
        "acme",
        "app",
        [],
        "installation",
        "PP-"
      )
    )

    expect([...states.existingBranches]).toEqual(["feat/pp-18-lowercase"])
    expect(graphql.mock.calls[1]?.[1]).toMatchObject({
      ref0: "refs/heads/feat/pp-18-lowercase",
      headRefName0: "feat/pp-18-lowercase"
    })
    expect(graphql.mock.calls[1]?.[1]).not.toHaveProperty("ref1")
  })

  it("fails branch discovery when GitHub omits the next cursor", async () => {
    graphql.mockResolvedValueOnce({
      repository: {
        defaultBranchRef: { name: "main" },
        refs: {
          nodes: [{ name: "PP-T-1" }],
          pageInfo: { hasNextPage: true, endCursor: null }
        }
      }
    })

    const error = await run(
      Effect.flip(
        fetchProjectStatesWithToken(
          "token",
          "acme",
          "app",
          [],
          "installation",
          "PP-"
        )
      )
    )

    expect(error._tag).toBe("GitHubError")
    expect(graphql).toHaveBeenCalledTimes(1)
  })

  it("fails safely when branch discovery reaches its page limit", async () => {
    for (let page = 0; page < 10; page += 1) {
      graphql.mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          refs: {
            nodes: [{ name: `PP-T-${page}` }],
            pageInfo: { hasNextPage: true, endCursor: `cursor-${page}` }
          }
        }
      })
    }

    const error = await run(
      Effect.flip(
        fetchProjectStatesWithToken(
          "token",
          "acme",
          "app",
          [],
          "installation",
          "PP-"
        )
      )
    )

    expect(error._tag).toBe("GitHubError")
    expect(graphql).toHaveBeenCalledTimes(10)
  })

  it("rejects malformed PR pages instead of treating them as absent PRs", async () => {
    graphql.mockResolvedValueOnce({
      repository: {
        defaultBranchRef: { name: "main" },
        b0: { name: "feat/T-1" },
        p0: { nodes: null }
      }
    })
    const error = await run(
      fetchProjectStatesWithToken(
        "token",
        "acme",
        "app",
        ["feat/T-1"],
        "installation"
      ).pipe(Effect.flip)
    )
    expect(error._tag).toBe("GitHubError")
  })

  it("rejects a repeated cursor instead of returning incomplete matches", async () => {
    graphql.mockResolvedValue({
      repository: {
        defaultBranchRef: { name: "main" },
        b0: { name: "feat/T-1" },
        p0: {
          nodes: [],
          pageInfo: { hasNextPage: true, endCursor: "repeated" }
        }
      }
    })
    const error = await run(
      fetchProjectStatesWithToken(
        "token",
        "acme",
        "app",
        ["feat/T-1"],
        "installation"
      ).pipe(Effect.flip)
    )
    expect(error._tag).toBe("GitHubError")
    expect(graphql).toHaveBeenCalledTimes(2)
  })

  it("retains resolved branches when continuation aliases are reassigned", async () => {
    graphql
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          b0: { name: "feat/T-1" },
          p0: {
            nodes: [pr("feat/T-1")],
            pageInfo: { hasNextPage: true, endCursor: "unused" }
          },
          b1: { name: "feat/T-2" },
          p1: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } }
        }
      })
      .mockResolvedValueOnce({
        repository: {
          defaultBranchRef: { name: "main" },
          b0: { name: "feat/T-2" },
          p0: {
            nodes: [
              { ...pr("feat/T-2", "MERGED"), mergedAt: "2026-09-07T12:00:00Z" }
            ],
            pageInfo: { hasNextPage: false, endCursor: null }
          }
        }
      })
    const states = await run(
      fetchProjectStatesWithToken(
        "token",
        "acme",
        "app",
        ["feat/T-1", "feat/T-2"],
        "installation"
      )
    )
    expect(states.prByBranch.get("feat/T-1")?.state).toBe("open")
    expect(states.prByBranch.get("feat/T-2")?.mergedAt?.toISOString()).toBe(
      "2026-09-07T12:00:00.000Z"
    )
    expect([...states.existingBranches]).toEqual(["feat/T-1", "feat/T-2"])
    expect(graphql.mock.calls[1]?.[1]).toMatchObject({
      headRefName0: "feat/T-2",
      cursor0: "next"
    })
    expect(graphql.mock.calls[1]?.[1]).not.toHaveProperty("headRefName1")
  })

  it("maps batched alias responses back to project state", () => {
    const states = projectStatesFromBatchResponses([
      {
        branches: ["feat/T-1"],
        response: {
          repository: {
            defaultBranchRef: { name: "trunk" },
            b0: { name: "feat/T-1" },
            p0: { nodes: [pr("feat/T-1")] }
          }
        }
      },
      {
        branches: ["bug/T-2"],
        response: {
          repository: {
            defaultBranchRef: { name: "trunk" },
            b0: null,
            p0: { nodes: [pr("bug/T-2", "CLOSED", "FAILURE")] }
          }
        }
      }
    ])

    expect(states?.defaultBranch).toBe("trunk")
    expect([...(states?.existingBranches ?? [])]).toEqual(["feat/T-1"])
    expect(states?.prByBranch.get("feat/T-1")?.checks).toBe("passing")
    expect(states?.prByBranch.get("bug/T-2")?.state).toBe("closed")
    expect(states?.prByBranch.get("bug/T-2")?.checks).toBe("failing")
  })

  it("keeps the batch when one branch ref is stale", () => {
    const states = projectStatesFromBatchResponses([
      {
        branches: ["feat/live", "feat/stale"],
        response: {
          repository: {
            defaultBranchRef: { name: "main" },
            b0: { name: "feat/live" },
            p0: { nodes: [pr("feat/live")] },
            b1: null,
            p1: null
          }
        }
      }
    ])

    expect(states).not.toBeNull()
    expect([...(states?.existingBranches ?? [])]).toEqual(["feat/live"])
    expect(states?.prByBranch.has("feat/live")).toBe(true)
    expect(states?.prByBranch.has("feat/stale")).toBe(false)
  })

  it("keeps the batch when a branch's pull-request alias is missing", () => {
    const states = projectStatesFromBatchResponses([
      {
        branches: ["feat/has-pr", "feat/no-pr"],
        response: {
          repository: {
            defaultBranchRef: { name: "main" },
            b0: { name: "feat/has-pr" },
            p0: { nodes: [pr("feat/has-pr")] },
            b1: { name: "feat/no-pr" }
          }
        }
      }
    ])

    expect(states).not.toBeNull()
    expect([...(states?.existingBranches ?? [])].toSorted()).toEqual([
      "feat/has-pr",
      "feat/no-pr"
    ])
    expect(states?.prByBranch.has("feat/has-pr")).toBe(true)
    expect(states?.prByBranch.has("feat/no-pr")).toBe(false)
  })

  it("maps a missing repository to RepoGone", () => {
    const states = projectStatesFromBatchResponses([
      {
        branches: ["feat/whatever"],
        response: { repository: null }
      }
    ])

    expect(states).toBeNull()
  })

  it("prefers a same-repository open PR over a newer closed or merged PR", () => {
    const states = projectStatesFromBatchResponses([
      {
        branches: ["feat/T-3"],
        response: {
          repository: {
            defaultBranchRef: { name: "main" },
            b0: { name: "feat/T-3" },
            p0: {
              nodes: [pr("feat/T-3", "MERGED"), pr("feat/T-3", "OPEN")]
            }
          }
        }
      }
    ])

    expect(states?.prByBranch.get("feat/T-3")?.state).toBe("open")
  })

  it("ignores fork PRs even when they precede the same-repository PR", () => {
    const forkPr = {
      ...pr("feat/T-4", "OPEN"),
      headRepository: { id: "fork-repo" }
    }
    const states = projectStatesFromBatchResponses([
      {
        branches: ["feat/T-4"],
        response: {
          repository: {
            defaultBranchRef: { name: "main" },
            b0: { name: "feat/T-4" },
            p0: {
              nodes: [forkPr, pr("feat/T-4", "CLOSED")]
            }
          }
        }
      }
    ])

    expect(states?.prByBranch.get("feat/T-4")?.state).toBe("closed")
  })
})

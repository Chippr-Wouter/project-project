import { describe, expect, it } from "vite-plus/test"
import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import { TicketId, TicketStatus } from "@projectproject/shared"
import type { RawProjectStates } from "./Services/GitHub"
import {
  planPullRequestWebhookTicket,
  planTicketGitStates,
  type TicketGitStateInput
} from "./ticketGitStatePlanner"

const now = DateTime.toDate(DateTime.unsafeMake("2026-05-08T10:00:00.000Z"))
const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)

const baseTicket = {
  id: ticketId("T-1"),
  status: ticketStatus("in_progress"),
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null
} satisfies TicketGitStateInput

function raw(overrides: Partial<RawProjectStates> = {}): RawProjectStates {
  return {
    defaultBranch: "main",
    existingBranches: new Set(),
    prByBranch: new Map(),
    ...overrides
  }
}

describe("planTicketGitStates", () => {
  it("marks tickets without branches without writes", () => {
    const plan = planTicketGitStates([baseTicket], raw(), now)

    expect(plan.states).toEqual({
      "T-1": { tag: "no_branch", baseBranch: "main" }
    })
    expect(plan.transitioned).toEqual([])
    expect(plan.writes).toEqual([])
  })

  it("marks missing remote branches as stale", () => {
    const plan = planTicketGitStates(
      [{ ...baseTicket, branch: "feat/T-1" }],
      raw(),
      now
    )

    expect(plan.states["T-1"]).toEqual({
      tag: "stale_branch",
      name: "feat/T-1"
    })
    expect(plan.writes).toEqual([])
  })

  it("auto-transitions a ticket when its PR merged", () => {
    const plan = planTicketGitStates(
      [{ ...baseTicket, branch: "feat/T-1" }],
      raw({
        existingBranches: new Set(["feat/T-1"]),
        prByBranch: new Map([
          [
            "feat/T-1",
            {
              headRefName: "feat/T-1",
              baseRefName: "main",
              state: "merged",
              draft: false,
              number: 42,
              url: "https://github.test/pr/42",
              title: "Ship it",
              mergedAt: null,
              checks: "passing"
            }
          ]
        ])
      }),
      now
    )

    expect(plan.states["T-1"]).toEqual({
      tag: "pr_merged",
      branch: "feat/T-1",
      baseBranch: "main",
      number: 42,
      url: "https://github.test/pr/42",
      title: "Ship it",
      mergedAt: now
    })
    expect(plan.transitioned).toEqual([
      {
        ticketId: "T-1",
        fromStatus: ticketStatus("in_progress"),
        toStatus: ticketStatus("done"),
        prNumber: 42
      }
    ])
    expect(plan.writes).toEqual([
      {
        ticketId: "T-1",
        patch: {
          status: ticketStatus("done"),
          pr: 42,
          prState: "merged",
          lastTransitionedPr: 42
        }
      }
    ])
  })

  it("does not re-transition an already transitioned merged PR", () => {
    const plan = planTicketGitStates(
      [
        {
          ...baseTicket,
          status: ticketStatus("done"),
          branch: "feat/T-1",
          pr: 42,
          prState: "merged",
          lastTransitionedPr: 42
        }
      ],
      raw({
        existingBranches: new Set(["feat/T-1"]),
        prByBranch: new Map([
          [
            "feat/T-1",
            {
              headRefName: "feat/T-1",
              baseRefName: "main",
              state: "merged",
              draft: false,
              number: 42,
              url: "https://github.test/pr/42",
              title: "Ship it",
              mergedAt: now,
              checks: "passing"
            }
          ]
        ])
      }),
      now
    )

    expect(plan.transitioned).toEqual([])
    expect(plan.writes).toEqual([])
  })
})

describe("planPullRequestWebhookTicket", () => {
  const webhookTicket = (
    input: Partial<TicketGitStateInput> = {}
  ): TicketGitStateInput => ({
    id: ticketId("T-84"),
    status: ticketStatus("in_progress"),
    branch: "feat/T-84-pr-webhook-lifecycle",
    pr: null,
    prState: null,
    lastTransitionedPr: null,
    ...input
  })

  it("associates open pull requests without changing ticket status", () => {
    expect(
      planPullRequestWebhookTicket(webhookTicket(), {
        number: 80,
        state: "open"
      })
    ).toEqual({
      ticketId: "T-84",
      patch: { pr: 80, prState: "open" }
    })
  })

  it("does not rewrite unchanged open pull request associations", () => {
    expect(
      planPullRequestWebhookTicket(webhookTicket({ pr: 80, prState: "open" }), {
        number: 80,
        state: "open"
      })
    ).toBeNull()
  })

  it("persists closed pull requests without changing ticket status", () => {
    expect(
      planPullRequestWebhookTicket(webhookTicket(), {
        number: 80,
        state: "closed"
      })
    ).toEqual({
      ticketId: "T-84",
      patch: { pr: 80, prState: "closed" }
    })
  })

  it("transitions merged pull requests to done once", () => {
    expect(
      planPullRequestWebhookTicket(webhookTicket(), {
        number: 80,
        state: "merged"
      })
    ).toEqual({
      ticketId: "T-84",
      patch: {
        status: ticketStatus("done"),
        pr: 80,
        prState: "merged",
        lastTransitionedPr: 80
      }
    })
    expect(
      planPullRequestWebhookTicket(
        webhookTicket({
          status: ticketStatus("done"),
          pr: 80,
          prState: "merged",
          lastTransitionedPr: 80
        }),
        { number: 80, state: "merged" }
      )
    ).toBeNull()
  })

  it("records lastTransitionedPr for already-done merged pull requests", () => {
    expect(
      planPullRequestWebhookTicket(
        webhookTicket({ status: ticketStatus("done") }),
        {
          number: 80,
          state: "merged"
        }
      )
    ).toEqual({
      ticketId: "T-84",
      patch: { pr: 80, prState: "merged", lastTransitionedPr: 80 }
    })
  })
})

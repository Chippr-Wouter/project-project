import * as Exit from "effect/Exit"
import { describe, expect, it } from "vite-plus/test"
import { orgActionError, orgActionErrorFromExit } from "./orgErrors"

describe("orgActionError", () => {
  it("surfaces project slugs for a blocked owner removal", () => {
    const result = orgActionError({
      code: "PROJECT_OWNER_REMOVAL_BLOCKED",
      projectSlugs: ["alpha", "beta"]
    })
    expect(result.projectSlugs).toEqual(["alpha", "beta"])
  })

  it("maps distinct error codes to distinct messages", () => {
    const alreadyMember = orgActionError({
      code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION"
    })
    const alreadyInvited = orgActionError({
      code: "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION"
    })
    const lastOwner = orgActionError({ code: "LAST_ORG_OWNER_BLOCKED" })
    const onlyOwnerLeave = orgActionError({
      code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER"
    })

    const messages = [
      alreadyMember.message,
      alreadyInvited.message,
      lastOwner.message,
      onlyOwnerLeave.message
    ]
    expect(new Set(messages).size).toBe(messages.length)
    for (const message of messages) expect(message.length).toBeGreaterThan(0)
  })

  it("falls back to a generic message for unknown causes", () => {
    const result = orgActionError({ code: "SOMETHING_UNEXPECTED" })
    expect(result.message.length).toBeGreaterThan(0)
    expect(result.projectSlugs).toBeUndefined()
  })
})

describe("orgActionErrorFromExit", () => {
  it("returns null for a successful exit", () => {
    expect(orgActionErrorFromExit(Exit.succeed(undefined))).toBeNull()
  })

  it("unwraps a wrapped better-auth error (UnknownException shape)", () => {
    const exit = Exit.fail({
      _tag: "UnknownException",
      error: { code: "PROJECT_OWNER_REMOVAL_BLOCKED", projectSlugs: ["x"] }
    })
    const result = orgActionErrorFromExit(exit)
    expect(result?.projectSlugs).toEqual(["x"])
  })

  it("reads a directly-failed better-auth error", () => {
    const exit = Exit.fail({
      code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER"
    })
    const direct = orgActionErrorFromExit(exit)
    const expected = orgActionError({
      code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER"
    })
    expect(direct?.message).toBe(expected.message)
  })
})

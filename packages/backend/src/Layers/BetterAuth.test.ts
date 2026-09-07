import { beforeEach, describe, expect, it, vi } from "vite-plus/test"
import * as Effect from "effect/Effect"
import { BetterAuth } from "../Services/BetterAuth"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn()
}))

vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(() => ({
    query: {
      account: {
        findFirst: mocks.findFirst
      }
    }
  }))
}))

vi.mock("../auth", () => ({
  auth: {
    handler: vi.fn(),
    api: {
      getSession: vi.fn(),
      oAuthConsent: vi.fn()
    }
  }
}))

import { BetterAuthLive } from "./BetterAuth"

describe("BetterAuthLive getPersonalGithub", () => {
  beforeEach(() => {
    mocks.findFirst.mockReset()
  })

  it("returns connected when the user has a GitHub account row", async () => {
    mocks.findFirst.mockResolvedValue({ id: "account-1" })

    const result = await runGetPersonalGithub("user-1")

    expect(result).toEqual({ connected: true })
    expect(mocks.findFirst).toHaveBeenCalledOnce()
  })

  it("returns disconnected when the user has no GitHub account row", async () => {
    mocks.findFirst.mockResolvedValue(undefined)

    const result = await runGetPersonalGithub("user-1")

    expect(result).toEqual({ connected: false })
    expect(mocks.findFirst).toHaveBeenCalledOnce()
  })
})

const runGetPersonalGithub = (userId: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* BetterAuth
      return yield* service.getPersonalGithub(userId)
    }).pipe(Effect.provide(BetterAuthLive))
  )

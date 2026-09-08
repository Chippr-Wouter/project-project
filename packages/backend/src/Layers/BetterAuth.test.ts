import { beforeEach, describe, expect, it, vi } from "vite-plus/test"
import * as Effect from "effect/Effect"
import { BetterAuth } from "../Services/BetterAuth"

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  oauth2Consent: vi.fn()
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
      oauth2Consent: mocks.oauth2Consent
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

it("passes the HTTP request through when accepting OAuth consent", async () => {
  const request = new Request(
    "http://localhost/api/oauth-applications/consent",
    {
      method: "POST",
      headers: { cookie: "session=fixture" }
    }
  )
  const input = { accept: true, oauth_query: "signed-query" }
  mocks.oauth2Consent.mockResolvedValue({
    url: "http://localhost/callback?code=fixture"
  })

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* BetterAuth
      return yield* service.submitConsent(request, input)
    }).pipe(Effect.provide(BetterAuthLive))
  )

  expect(mocks.oauth2Consent).toHaveBeenCalledWith({
    asResponse: false,
    request,
    headers: request.headers,
    body: input
  })
  expect(result).toEqual({
    redirectURI: "http://localhost/callback?code=fixture"
  })
})

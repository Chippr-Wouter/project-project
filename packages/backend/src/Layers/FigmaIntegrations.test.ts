import { it } from "@effect/vitest"
import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected
} from "@projectproject/shared"
import * as ConfigProvider from "effect/ConfigProvider"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, vi } from "vitest"
import { chooseCredential, isTokenExpired } from "../Services/FigmaIntegrations"
import {
  figmaOAuthClient,
  refreshAccessToken,
  resolveCredential,
  type FigmaTokenGrant
} from "./FigmaIntegrations"

const at = (iso: string): Date =>
  DateTime.toDate(DateTime.unsafeMake(Date.parse(iso)))

describe("chooseCredential", () => {
  it("prefers the personal oauth token", () => {
    expect(
      chooseCredential({ personalToken: "personal", projectToken: "project" })
    ).toEqual({ _tag: "Bearer", token: "personal" })
  })

  it("falls back to the project token", () => {
    expect(
      chooseCredential({ personalToken: null, projectToken: "project" })
    ).toEqual({ _tag: "FigmaToken", token: "project" })
  })

  it("returns null when neither is present", () => {
    expect(
      chooseCredential({ personalToken: null, projectToken: null })
    ).toBeNull()
  })
})

describe("isTokenExpired", () => {
  const now = at("2026-09-04T12:00:00Z")

  it("treats a token expiring inside the skew window as expired", () => {
    expect(isTokenExpired(at("2026-09-04T12:04:00Z"), now)).toBe(true)
  })

  it("treats a token well in the future as valid", () => {
    expect(isTokenExpired(at("2026-10-04T12:00:00Z"), now)).toBe(false)
  })

  it("treats an already-past expiry as expired", () => {
    expect(isTokenExpired(at("2026-09-03T12:00:00Z"), now)).toBe(true)
  })
})

const now = at("2026-09-04T12:00:00Z")

const client = { clientId: "client-id", clientSecret: "client-secret" }

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })

const harness = (personal: {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: Date
}) => {
  const persisted: Array<FigmaTokenGrant> = []
  const rejections: Array<string> = []
  return {
    persisted,
    rejections,
    run: (projectToken: string | null) =>
      resolveCredential({
        personal,
        projectToken,
        now,
        refresh: (refreshToken) =>
          refreshAccessToken({ client, refreshToken, now }),
        persist: (grant) =>
          Effect.sync(() => {
            persisted.push(grant)
          }),
        onGrantRejected: Effect.sync(() => {
          rejections.push("rejected")
        })
      })
  }
}

describe("credentialFor refresh on expiry", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect(
    "refreshes a personal token inside the skew window, persists it and uses it",
    () =>
      Effect.gen(function* () {
        const fetchMock = vi.fn(async (_input: string | URL) =>
          jsonResponse(200, {
            access_token: "refreshed-token",
            expires_in: 7776000
          })
        )
        vi.stubGlobal("fetch", fetchMock)
        const test = harness({
          accessToken: "stale-token",
          refreshToken: "refresh-token",
          expiresAt: at("2026-09-04T12:04:00Z")
        })

        const credential = yield* test.run("project-token")

        expect(credential).toEqual({
          _tag: "Bearer",
          token: "refreshed-token"
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
          "https://api.figma.com/v1/oauth/refresh"
        )
        expect(test.persisted).toHaveLength(1)
        expect(test.persisted[0]?.accessToken).toBe("refreshed-token")
        expect(test.persisted[0]?.refreshToken).toBe("refresh-token")
        expect(test.persisted[0]?.expiresAt.toISOString()).toBe(
          "2026-12-03T12:00:00.000Z"
        )
        expect(test.rejections).toEqual([])
      })
  )

  it.effect("marks the connection broken when figma rejects the grant", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }))
      )
      const test = harness({
        accessToken: "stale-token",
        refreshToken: "refresh-token",
        expiresAt: at("2026-09-04T12:04:00Z")
      })

      const error = yield* Effect.flip(test.run("project-token"))

      expect(Schema.is(FigmaAuthInvalid)(error)).toBe(true)
      expect(test.persisted).toEqual([])
      expect(test.rejections).toEqual(["rejected"])
    })
  )

  it.effect("treats a 401 from the refresh endpoint as a rejected grant", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(401, { error: "invalid_grant" }))
      )
      const test = harness({
        accessToken: "stale-token",
        refreshToken: "refresh-token",
        expiresAt: at("2026-09-04T12:04:00Z")
      })

      const error = yield* Effect.flip(test.run("project-token"))

      expect(Schema.is(FigmaAuthInvalid)(error)).toBe(true)
      expect(test.rejections).toEqual(["rejected"])
    })
  )

  it.effect(
    "leaves the connection untouched when the refresh cannot reach figma",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new TypeError("fetch failed")
          })
        )
        const test = harness({
          accessToken: "stale-token",
          refreshToken: "refresh-token",
          expiresAt: at("2026-09-04T12:04:00Z")
        })

        const error = yield* Effect.flip(test.run("project-token"))

        if (!Schema.is(FigmaError)(error)) throw error
        expect(error.reason).toBe("figma_refresh_unreachable")
        expect(test.persisted).toEqual([])
        expect(test.rejections).toEqual([])
      })
  )

  it.effect(
    "leaves the connection untouched when figma answers the refresh with a 5xx",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => jsonResponse(503, { message: "unavailable" }))
        )
        const test = harness({
          accessToken: "stale-token",
          refreshToken: "refresh-token",
          expiresAt: at("2026-09-04T12:04:00Z")
        })

        const error = yield* Effect.flip(test.run("project-token"))

        if (!Schema.is(FigmaError)(error)) throw error
        expect(error.reason).toBe("figma_refresh_unavailable")
        expect(test.persisted).toEqual([])
        expect(test.rejections).toEqual([])
      })
  )

  it.effect("does not refresh a personal token comfortably in the future", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async () => jsonResponse(200, {}))
      vi.stubGlobal("fetch", fetchMock)
      const test = harness({
        accessToken: "fresh-token",
        refreshToken: "refresh-token",
        expiresAt: at("2026-10-04T12:00:00Z")
      })

      const credential = yield* test.run("project-token")

      expect(credential).toEqual({ _tag: "Bearer", token: "fresh-token" })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(test.persisted).toEqual([])
    })
  )

  it.effect("fails FigmaNotConnected when neither credential exists", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        resolveCredential({
          personal: null,
          projectToken: null,
          now,
          refresh: () => Effect.die("unreachable"),
          persist: () => Effect.void,
          onGrantRejected: Effect.void
        })
      )
      expect(Schema.is(FigmaNotConnected)(error)).toBe(true)
    })
  )

  it.effect("resolves the project credential when no user is present", () =>
    Effect.gen(function* () {
      const credential = yield* resolveCredential({
        personal: null,
        projectToken: "project-token",
        now,
        refresh: () => Effect.die("unreachable"),
        persist: () => Effect.void,
        onGrantRejected: Effect.void
      })
      expect(credential).toEqual({
        _tag: "FigmaToken",
        token: "project-token"
      })
    })
  )
})

describe("figmaOAuthClient", () => {
  it.effect("fails FigmaError when the figma credentials are absent", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(figmaOAuthClient)
      if (!Schema.is(FigmaError)(error)) throw error
      expect(error.reason).toBe("figma_oauth_unconfigured")
    }).pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map())))
  )

  it.effect("fails FigmaError when only the client id is present", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(figmaOAuthClient)
      expect(Schema.is(FigmaError)(error)).toBe(true)
    }).pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map([["FIGMA_CLIENT_ID", "client-id"]]))
      )
    )
  )

  it.effect("reads both credentials when they are configured", () =>
    Effect.gen(function* () {
      const configured = yield* figmaOAuthClient
      expect(configured.clientId).toBe("client-id")
      expect(configured.clientSecret).toBe("client-secret")
    }).pipe(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([
            ["FIGMA_CLIENT_ID", "client-id"],
            ["FIGMA_CLIENT_SECRET", "client-secret"]
          ])
        )
      )
    )
  )
})

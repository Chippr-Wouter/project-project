import { it } from "@effect/vitest"
import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected
} from "@projectproject/shared"
import { drizzle } from "drizzle-orm/pg-proxy"
import { createHash } from "node:crypto"
import * as ConfigProvider from "effect/ConfigProvider"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, vi } from "vitest"
import { chooseCredential, isTokenExpired } from "../Services/FigmaIntegrations"
import * as schema from "../db/schema"
import {
  consumeOauthStateQuery,
  exchangeAuthorizationCode,
  figmaOAuthClient,
  refreshAccessToken,
  requireConsumedState,
  resolveCredential,
  startOauthFlow,
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

const client = {
  clientId: "client-id",
  clientSecret: Redacted.make("client-secret")
}

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
      expect(Redacted.isRedacted(configured.clientSecret)).toBe(true)
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

const emptyConfig = ConfigProvider.fromMap(new Map())

describe("credentialFor without oauth configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const lazyRefresh = (refreshToken: string) =>
    Effect.flatMap(figmaOAuthClient, (oauth) =>
      refreshAccessToken({ client: oauth, refreshToken, now })
    )

  it.effect(
    "resolves the project pat for a background caller on a pat-only deploy",
    () =>
      Effect.gen(function* () {
        const fetchMock = vi.fn(async () => jsonResponse(200, {}))
        vi.stubGlobal("fetch", fetchMock)

        const credential = yield* resolveCredential({
          personal: null,
          projectToken: "project-pat",
          now,
          refresh: lazyRefresh,
          persist: () => Effect.void,
          onGrantRejected: Effect.void
        })

        expect(credential).toEqual({
          _tag: "FigmaToken",
          token: "project-pat"
        })
        expect(fetchMock).not.toHaveBeenCalled()
      }).pipe(Effect.withConfigProvider(emptyConfig))
  )

  it.effect(
    "does not read oauth configuration for a personal token that is still valid",
    () =>
      Effect.gen(function* () {
        const credential = yield* resolveCredential({
          personal: {
            accessToken: "fresh-token",
            refreshToken: "refresh-token",
            expiresAt: at("2026-10-04T12:00:00Z")
          },
          projectToken: "project-pat",
          now,
          refresh: lazyRefresh,
          persist: () => Effect.void,
          onGrantRejected: Effect.void
        })

        expect(credential).toEqual({ _tag: "Bearer", token: "fresh-token" })
      }).pipe(Effect.withConfigProvider(emptyConfig))
  )

  it.effect(
    "surfaces the configuration failure only when a refresh is actually needed",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          resolveCredential({
            personal: {
              accessToken: "stale-token",
              refreshToken: "refresh-token",
              expiresAt: at("2026-09-04T12:04:00Z")
            },
            projectToken: "project-pat",
            now,
            refresh: lazyRefresh,
            persist: () => Effect.void,
            onGrantRejected: Effect.void
          })
        )
        if (!Schema.is(FigmaError)(error)) throw error
        expect(error.reason).toBe("figma_oauth_unconfigured")
      }).pipe(Effect.withConfigProvider(emptyConfig))
  )
})

const recordingDb = () => {
  const calls: Array<{ readonly sql: string }> = []
  const db = drizzle(
    async (sql: string) => {
      calls.push({ sql })
      return { rows: [] }
    },
    { schema }
  )
  return { calls, db }
}

describe("consumeOauthStateQuery", () => {
  const { db } = recordingDb()
  const state = "raw-state-value"
  const built = consumeOauthStateQuery(
    db,
    "user-1",
    state,
    at("2026-09-04T12:00:00Z")
  ).toSQL()

  it("rejects an already-consumed state by guarding on consumed_at", () => {
    expect(built.sql).toContain('"consumed_at" is null')
  })

  it("rejects an expired state by guarding on expires_at", () => {
    expect(built.sql).toContain('"expires_at" >')
  })

  it("rejects another user's state by guarding on user_id", () => {
    expect(built.sql).toContain('"user_id" =')
    expect(built.params).toContain("user-1")
  })

  it("marks the row consumed and returns it in one statement", () => {
    expect(built.sql).toContain("update")
    expect(built.sql).toContain('set "consumed_at"')
    expect(built.sql).toContain("returning")
  })

  it("matches on the state hash and never sends the raw state", () => {
    const hashed = createHash("sha256").update(state).digest("hex")
    expect(built.params).toContain(hashed)
    expect(built.params).not.toContain(state)
    expect(built.sql).not.toContain(state)
  })
})

describe("requireConsumedState", () => {
  it.effect("fails FigmaAuthInvalid when no row was consumed", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(requireConsumedState([]))
      expect(Schema.is(FigmaAuthInvalid)(error)).toBe(true)
    })
  )

  it.effect("succeeds when exactly one row was consumed", () =>
    requireConsumedState([{ id: "state-1" }])
  )
})

describe("startOauthFlow", () => {
  it.effect("fails FigmaError and writes no state row when unconfigured", () =>
    Effect.gen(function* () {
      const { calls, db } = recordingDb()
      const error = yield* Effect.flip(
        startOauthFlow({
          db,
          client: figmaOAuthClient,
          redirectUri: Effect.succeed("https://example.test/callback"),
          userId: "user-1"
        })
      )
      if (!Schema.is(FigmaError)(error)) throw error
      expect(error.reason).toBe("figma_oauth_unconfigured")
      expect(calls).toEqual([])
    }).pipe(Effect.withConfigProvider(emptyConfig))
  )
})

describe("exchangeAuthorizationCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const exchange = () =>
    exchangeAuthorizationCode({
      client,
      redirectUri: "https://example.test/callback",
      code: "auth-code",
      now
    })

  it.effect("fails FigmaAuthInvalid when figma rejects the code", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }))
      )
      const error = yield* Effect.flip(exchange())
      expect(Schema.is(FigmaAuthInvalid)(error)).toBe(true)
    })
  )

  it.effect("fails FigmaError when the token endpoint is unreachable", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("fetch failed")
        })
      )
      const error = yield* Effect.flip(exchange())
      if (!Schema.is(FigmaError)(error)) throw error
      expect(error.reason).toBe("figma_token_exchange_unreachable")
    })
  )

  it.effect("fails FigmaError when the grant carries no refresh token", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(200, { access_token: "access", expires_in: 7776000 })
        )
      )
      const error = yield* Effect.flip(exchange())
      if (!Schema.is(FigmaError)(error)) throw error
      expect(error.reason).toBe("figma_token_response_invalid")
    })
  )

  it.effect("posts the code once and returns the grant", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn(async (_input: string | URL) =>
        jsonResponse(200, {
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 7776000
        })
      )
      vi.stubGlobal("fetch", fetchMock)

      const grant = yield* exchange()

      expect(grant.accessToken).toBe("access")
      expect(grant.refreshToken).toBe("refresh")
      expect(grant.expiresAt.toISOString()).toBe("2026-12-03T12:00:00.000Z")
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.figma.com/v1/oauth/token"
      )
    })
  )
})

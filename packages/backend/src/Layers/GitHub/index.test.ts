import { beforeEach, describe, expect, vi } from "vite-plus/test"
import { it } from "@effect/vitest"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { BetterAuth, type BetterAuthShape } from "../../Services/BetterAuth"

vi.mock("./appAuth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./appAuth")>()
  return {
    ...actual,
    appAuth: vi.fn(actual.appAuth)
  }
})

const { appAuth } = await import("./appAuth")
const { GitHubLive } = await import("./index")

const appAuthMock = vi.mocked(appAuth)

const fakeBetterAuth: BetterAuthShape = {
  handler: () => Effect.die("not implemented"),
  getSession: () => Effect.die("not implemented"),
  getGithubAccessToken: () => Effect.die("not implemented"),
  getPersonalGithub: () => Effect.die("not implemented"),
  getPersonalEverhour: () => Effect.die("not implemented"),
  getOrgSlugById: () => Effect.die("not implemented"),
  listOrganizations: () => Effect.die("not implemented"),
  listOrganizationsPaged: () => Effect.die("not implemented"),
  getOrganization: () => Effect.die("not implemented"),
  submitConsent: () => Effect.die("not implemented")
}

const FakeBetterAuthLive = Layer.succeed(BetterAuth, fakeBetterAuth)

const buildGitHubLayer = (config: Map<string, string>) =>
  Layer.build(GitHubLive.pipe(Layer.provide(FakeBetterAuthLive))).pipe(
    Effect.scoped,
    Effect.withConfigProvider(ConfigProvider.fromMap(config))
  )

const validConfig = new Map([
  ["GITHUB_APP_ID", "123"],
  [
    "GITHUB_APP_PRIVATE_KEY",
    "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----"
  ],
  ["GITHUB_APP_CLIENT_ID", "client-id"],
  ["GITHUB_APP_CLIENT_SECRET", "client-secret"]
])

describe("GitHubLive", () => {
  beforeEach(() => {
    appAuthMock.mockClear()
  })

  it.effect(
    "fails to construct the layer when GitHub App config is missing",
    () =>
      Effect.gen(function* () {
        const error = yield* buildGitHubLayer(new Map()).pipe(Effect.flip)

        expect(error._tag).toBe("GitHubError")
        expect(appAuthMock).toHaveBeenCalledTimes(1)
      })
  )

  it.effect("acquires appAuth exactly once during layer construction", () =>
    Effect.gen(function* () {
      yield* buildGitHubLayer(validConfig)

      expect(appAuthMock).toHaveBeenCalledTimes(1)
    })
  )
})

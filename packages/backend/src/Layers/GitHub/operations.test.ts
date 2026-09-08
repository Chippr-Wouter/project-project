import { beforeEach, describe, expect, vi } from "vite-plus/test"
import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { Octokit } from "octokit"
import { BetterAuth, type BetterAuthShape } from "../../Services/BetterAuth"
import { GitHub } from "../../Services/GitHub"
import * as GitHubRequest from "./request"
import * as ProjectStateCache from "./projectStateCache"

const { authenticate, fetch } = vi.hoisted(() => ({
  authenticate:
    vi.fn<
      (options: {
        type: string
        installationId?: number
      }) => Promise<{ token: string }>
    >(),
  fetch: vi.fn<typeof globalThis.fetch>()
}))

vi.mock("./appAuth", () => ({
  appAuth: () => Effect.succeed(authenticate)
}))

vi.mock("./clients", () => ({
  octokitFor: (token: string) =>
    new Octokit({
      auth: token,
      request: { fetch },
      retry: { enabled: false },
      throttle: { enabled: false }
    })
}))

const { GitHubLive } = await import("./index")

const fakeBetterAuth: BetterAuthShape = {
  handler: () => Effect.die("not implemented"),
  getSession: () => Effect.die("not implemented"),
  getGithubAccessToken: () => Effect.succeed("user-token"),
  getPersonalGithub: () => Effect.die("not implemented"),
  getPersonalEverhour: () => Effect.die("not implemented"),
  getOrgSlugById: () => Effect.die("not implemented"),
  listOrganizations: () => Effect.die("not implemented"),
  listOrganizationsPaged: () => Effect.die("not implemented"),
  getOrganization: () => Effect.die("not implemented"),
  submitConsent: () => Effect.die("not implemented")
}

const layer = GitHubLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(BetterAuth, fakeBetterAuth),
      GitHubRequest.layer,
      ProjectStateCache.layer
    )
  )
)
const args = {
  head: "feat/T-1",
  base: "main",
  title: "Implement ticket",
  body: "Details",
  draft: false
}
const pullRequest = {
  number: 42,
  html_url: "https://github.com/acme/app/pull/42",
  head: { ref: args.head, repo: { id: 1 } },
  base: { ref: args.base, repo: { id: 1 } }
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  })

beforeEach(() => {
  authenticate.mockReset().mockResolvedValue({ token: "installation-token" })
  fetch.mockReset()
})

describe("GitHub installation authentication", () => {
  it.effect(
    "shares the app budget without blocking installation requests",
    () =>
      Effect.gen(function* () {
        const appLimited = json({ message: "API rate limit exceeded" }, 429)
        appLimited.headers.set("retry-after", "60")
        const installationResponse = json({
          id: 1,
          owner: { login: "acme" },
          name: "app",
          default_branch: "main"
        })
        fetch
          .mockResolvedValueOnce(appLimited)
          .mockResolvedValueOnce(installationResponse)
        const github = yield* GitHub

        const firstAppCall = yield* github
          .getInstallationAccount("123")
          .pipe(Effect.flip)
        expect(firstAppCall._tag).toBe("RateLimited")

        const secondAppCall = yield* github
          .getInstallationAccount("456")
          .pipe(Effect.flip)
        expect(secondAppCall._tag).toBe("RateLimited")

        const installationCall = yield* github.verifyInstallationRepo(
          "123",
          "acme",
          "app"
        )
        expect(installationCall.repoId).toBe("1")
        expect(fetch).toHaveBeenCalledTimes(2)
      }).pipe(Effect.provide(layer))
  )

  it.effect("isolates installation access cooldowns between users", () =>
    Effect.gen(function* () {
      const installations = json({
        total_count: 1,
        installations: [{ id: 123 }]
      })
      Object.defineProperty(installations, "url", {
        value: "https://api.github.com/user/installations"
      })
      const limited = json({ message: "API rate limit exceeded" }, 429)
      limited.headers.set("retry-after", "60")
      fetch.mockResolvedValueOnce(limited).mockResolvedValueOnce(installations)
      const github = yield* GitHub
      yield* github
        .appUserCanAccessInstallation("limited-app-user", "123")
        .pipe(Effect.flip)
      expect(
        yield* github.appUserCanAccessInstallation("other-app-user", "123")
      ).toBe(true)
      yield* github
        .appUserCanAccessInstallation("limited-app-user", "123")
        .pipe(Effect.flip)
      expect(fetch).toHaveBeenCalledTimes(2)
    }).pipe(Effect.provide(layer))
  )

  it.effect("recovers immediately after a transient token failure", () =>
    Effect.gen(function* () {
      authenticate.mockRejectedValueOnce(new Error("Temporary failure"))
      fetch.mockResolvedValueOnce(
        json({
          id: 1,
          owner: { login: "acme" },
          name: "app",
          default_branch: "main"
        })
      )
      const github = yield* GitHub
      const error = yield* github
        .verifyInstallationRepo("123", "acme", "app")
        .pipe(Effect.flip)
      expect(error._tag).toBe("GitHubError")
      const repo = yield* github.verifyInstallationRepo("123", "acme", "app")
      expect(repo.repoId).toBe("1")
      expect(authenticate).toHaveBeenCalledTimes(2)
    }).pipe(Effect.provide(layer))
  )

  it.effect("lets App auth supply a renewed token on subsequent reads", () =>
    Effect.gen(function* () {
      authenticate
        .mockResolvedValueOnce({ token: "old-token" })
        .mockResolvedValueOnce({ token: "new-token" })
      fetch.mockImplementation(async () =>
        json({
          id: 1,
          owner: { login: "acme" },
          name: "app",
          default_branch: "main"
        })
      )
      const github = yield* GitHub
      yield* github.verifyInstallationRepo("123", "acme", "app")
      yield* github.verifyInstallationRepo("123", "acme", "app")
      expect(
        fetch.mock.calls.map(([, init]) =>
          new Headers(init?.headers).get("authorization")
        )
      ).toEqual(["token old-token", "token new-token"])
    }).pipe(Effect.provide(layer))
  )
})

describe("GitHub PR creation", () => {
  it.effect(
    "returns an existing same-repository PR without creating another",
    () =>
      Effect.gen(function* () {
        fetch.mockResolvedValueOnce(json([pullRequest]))
        const github = yield* GitHub
        expect(
          yield* github.openPullRequestAsUser("acme", "app", args, "user")
        ).toEqual({
          number: 42,
          url: pullRequest.html_url
        })
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(fetch.mock.calls[0]?.[0]).toEqual(
          expect.stringContaining("head=acme%3Afeat%2FT-1")
        )
      }).pipe(Effect.provide(layer))
  )

  it.effect("does not reuse a fork PR or a PR for another base", () =>
    Effect.gen(function* () {
      fetch
        .mockResolvedValueOnce(
          json([
            { ...pullRequest, head: { ref: args.head, repo: { id: 2 } } },
            { ...pullRequest, base: { ref: "release", repo: { id: 1 } } }
          ])
        )
        .mockResolvedValueOnce(json(pullRequest, 201))
      const github = yield* GitHub
      expect(
        yield* github.openPullRequestAsUser("acme", "app", args, "user")
      ).toEqual({
        number: 42,
        url: pullRequest.html_url
      })
      expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual([
        "GET",
        "POST"
      ])
      const payload = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Unknown)
      )(fetch.mock.calls[1]?.[1]?.body)
      expect(payload).toMatchObject(args)
    }).pipe(Effect.provide(layer))
  )

  it.effect(
    "recovers the existing PR when another request creates it concurrently",
    () =>
      Effect.gen(function* () {
        fetch
          .mockResolvedValueOnce(json([]))
          .mockResolvedValueOnce(
            json(
              { message: "A pull request already exists for acme:feat/T-1." },
              422
            )
          )
          .mockResolvedValueOnce(json([pullRequest]))
        const github = yield* GitHub
        expect(
          yield* github.openPullRequestAsUser("acme", "app", args, "user")
        ).toEqual({
          number: 42,
          url: pullRequest.html_url
        })
        expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual([
          "GET",
          "POST",
          "GET"
        ])
      }).pipe(Effect.provide(layer))
  )

  it.effect(
    "returns a stable error when duplicate PR recovery finds nothing",
    () =>
      Effect.gen(function* () {
        fetch
          .mockResolvedValueOnce(json([]))
          .mockResolvedValueOnce(
            json(
              { message: "A pull request already exists for acme:feat/T-1." },
              422
            )
          )
          .mockResolvedValueOnce(json([]))
        const github = yield* GitHub
        const error = yield* github
          .openPullRequestAsUser("acme", "app", args, "user")
          .pipe(Effect.flip)
        expect(error).toMatchObject({
          _tag: "GitHubError",
          message: "PR already exists for this branch"
        })
        expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual([
          "GET",
          "POST",
          "GET"
        ])
      }).pipe(Effect.provide(layer))
  )

  it.effect("surfaces validation errors without retrying the mutation", () =>
    Effect.gen(function* () {
      fetch
        .mockResolvedValueOnce(json([]))
        .mockResolvedValueOnce(
          json({ message: "No commits between main and feat/T-1" }, 422)
        )
      const github = yield* GitHub
      const error = yield* github
        .openPullRequestAsUser("acme", "app", args, "user")
        .pipe(Effect.flip)
      expect(error._tag).toBe("GitHubError")
      expect(fetch).toHaveBeenCalledTimes(2)
    }).pipe(Effect.provide(layer))
  )
})

it.effect(
  "does not replay a PR mutation after an ambiguous server failure",
  () =>
    Effect.gen(function* () {
      fetch
        .mockResolvedValueOnce(json([]))
        .mockResolvedValueOnce(json({ message: "Internal Server Error" }, 500))
      const github = yield* GitHub
      const error = yield* github
        .openPullRequestAsUser("acme", "app", args, "user")
        .pipe(Effect.flip)
      expect(error._tag).toBe("GitHubError")
      expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual([
        "GET",
        "POST"
      ])
    }).pipe(Effect.provide(layer))
)

it.effect(
  "does not replay a branch mutation after an ambiguous server failure",
  () =>
    Effect.gen(function* () {
      fetch
        .mockResolvedValueOnce(json({ commit: { sha: "abc123" } }))
        .mockResolvedValueOnce(json({ message: "Internal Server Error" }, 500))
      const github = yield* GitHub
      const error = yield* github
        .createBranchAsUser("acme", "app", args.head, args.base, "user")
        .pipe(Effect.flip)
      expect(error._tag).toBe("GitHubError")
      expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual([
        "GET",
        "POST"
      ])
    }).pipe(Effect.provide(layer))
)

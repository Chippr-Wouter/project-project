import { createHash } from "node:crypto"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
  GitHubError,
  GitHubTokenExpired,
  GithubRepo,
  GithubRepoPage,
  RateLimited
} from "@projectproject/shared"
import { BetterAuth } from "../../Services/BetterAuth"
import {
  GitHub,
  type GitHubInstallationAccount,
  type GitHubShape,
  type VerifiedInstallationRepo
} from "../../Services/GitHub"
import { appAuth } from "./appAuth"
import { octokitFor } from "./clients"
import {
  githubErrorMessage,
  mapHttpError,
  narrow,
  type TaggedFailure
} from "./errors"
import * as ProjectState from "./projectState"
import * as ProjectStateCache from "./projectStateCache"
import * as GitHubRequest from "./request"

export function githubRepoMatchesQuery(
  repo: {
    readonly owner?: { readonly login?: string | null } | null
    readonly name: string
    readonly description?: string | null
  },
  query: string
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const owner = repo.owner?.login ?? ""
  const haystack =
    `${owner}/${repo.name} ${owner} ${repo.name} ${repo.description ?? ""}`.toLowerCase()
  return tokens.every((token) => haystack.includes(token))
}

export function parseGithubRepoSlug(
  query: string
): { readonly owner: string; readonly name: string } | null {
  const trimmed = query.trim()
  const match = /^([^/\s]+)\/([^/\s]+)$/.exec(trimmed)
  if (!match) return null
  return { owner: match[1], name: match[2] }
}

export const GitHubLive = Layer.effect(
  GitHub,
  Effect.gen(function* () {
    const betterAuth = yield* BetterAuth
    const auth = yield* appAuth()
    const projectStateCache = yield* ProjectStateCache.ProjectStateCache
    const requestState = yield* GitHubRequest.GitHubRequestState

    const request = <A, EOut extends TaggedFailure>(
      attributes: GitHubRequest.GitHubRequestAttributes,
      fn: (signal: AbortSignal) => Promise<A>,
      narrowErr: (cause: unknown, now: number) => EOut
    ): Effect.Effect<A, EOut | RateLimited> =>
      GitHubRequest.githubRequest(attributes, fn, narrowErr).pipe(
        Effect.provideService(GitHubRequest.GitHubRequestState, requestState)
      )

    const tokenFor = (
      userId: string
    ): Effect.Effect<string, GitHubTokenExpired> =>
      betterAuth.getGithubAccessToken(userId).pipe(
        Effect.catchTag("NoGithubToken", () =>
          Effect.fail(new GitHubTokenExpired())
        ),
        Effect.catchTag("BetterAuthError", (e) => Effect.die(e))
      )

    const installationTokenFor = Effect.fn("GitHub.installationTokenFor")(
      function* (installationId: string) {
        const result = yield* Effect.tryPromise({
          try: () =>
            auth({
              type: "installation",
              installationId: Number(installationId)
            }),
          catch: (cause) =>
            new GitHubError({ message: githubErrorMessage(cause) })
        })
        return result.token
      }
    )

    const appToken = (): Effect.Effect<string, GitHubError> =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => auth({ type: "app" }),
          catch: (cause) => new GitHubError({ message: String(cause) })
        })
        return result.token
      })

    const getInstallationAccount = Effect.fn("GitHub.getInstallationAccount")(
      function* (installationId: string) {
        const token = yield* appToken()
        const octokit = octokitFor(token)
        const result = yield* request(
          {
            tokenSource: "app",
            operation: "getInstallationAccount",
            installationId
          },
          (signal) =>
            octokit.rest.apps.getInstallation({
              installation_id: Number(installationId),
              request: { signal }
            }),
          narrow(["RepoGone"] as const)
        )
        const account = result.data.account
        if (!account)
          return yield* new GitHubError({ message: "missing account" })
        const accountLogin = "login" in account ? account.login : account.slug
        const accountType =
          "type" in account && account.type === "Organization"
            ? "Organization"
            : "User"
        return {
          installationId,
          accountId: String(account.id),
          accountLogin,
          accountType
        } satisfies GitHubInstallationAccount
      }
    )

    const listInstallationRepos = Effect.fn("GitHub.listInstallationRepos")(
      function* (
        installationId: string,
        query: string | undefined,
        page: number
      ) {
        const token = yield* installationTokenFor(installationId)
        const octokit = octokitFor(token)
        const perPage = 30
        const response = yield* request(
          {
            tokenSource: "installation",
            operation: "listInstallationRepos",
            installationId,
            query: query ?? null,
            page
          },
          (signal) =>
            octokit.rest.apps.listReposAccessibleToInstallation({
              per_page: perPage,
              page,
              request: { signal }
            }),
          narrow(["RepoGone", "RateLimited"] as const)
        )
        const repos = response.data.repositories
          .filter((r) => {
            if (!query) return true
            return githubRepoMatchesQuery(r, query)
          })
          .map((r) =>
            GithubRepo.make({
              id: String(r.id),
              owner: r.owner.login,
              name: r.name,
              defaultBranch: r.default_branch,
              private: r.private,
              description: r.description ?? null
            })
          )
        return {
          repos,
          hasMore: page * perPage < response.data.total_count
        } satisfies GithubRepoPage
      }
    )

    const verifyInstallationRepo = Effect.fn("GitHub.verifyInstallationRepo")(
      function* (installationId: string, owner: string, name: string) {
        const token = yield* installationTokenFor(installationId)
        const octokit = octokitFor(token)
        const response = yield* request(
          {
            tokenSource: "installation",
            operation: "verifyInstallationRepo",
            installationId,
            repoOwner: owner,
            repoName: name
          },
          (signal) =>
            octokit.rest.repos.get({ owner, repo: name, request: { signal } }),
          narrow(["RepoGone"] as const)
        )
        return {
          repoId: String(response.data.id),
          owner: response.data.owner.login,
          name: response.data.name,
          defaultBranch: response.data.default_branch
        } satisfies VerifiedInstallationRepo
      }
    )

    const exchangeAppUserCode = Effect.fn("GitHub.exchangeAppUserCode")(
      function* (code: string) {
        const result = yield* Effect.tryPromise({
          try: () => auth({ type: "oauth-user", code }),
          catch: (cause) => new GitHubError({ message: String(cause) })
        }).pipe(
          Effect.annotateLogs({
            module: "GitHub",
            operation: "exchangeAppUserCode",
            tokenSource: "user"
          })
        )
        return result.token
      }
    )

    const appUserCanAccessInstallation = Effect.fn(
      "GitHub.appUserCanAccessInstallation"
    )(function* (userAccessToken: string, installationId: string) {
      const octokit = octokitFor(userAccessToken)
      const installations = yield* request(
        {
          tokenSource: "user",
          scopeKey: `app-user:${createHash("sha256").update(userAccessToken).digest("hex")}`,
          operation: "appUserCanAccessInstallation",
          installationId
        },
        (signal) =>
          octokit.paginate(
            octokit.rest.apps.listInstallationsForAuthenticatedUser,
            {
              per_page: 100,
              request: { signal }
            }
          ),
        narrow(["RateLimited"] as const)
      )
      return installations.some(
        (installation) => String(installation.id) === installationId
      )
    })

    const createBranchAsUser = Effect.fn("GitHub.createBranchAsUser")(
      function* (
        owner: string,
        name: string,
        branchName: string,
        baseBranch: string,
        userId: string
      ) {
        const token = yield* tokenFor(userId)
        const octokit = octokitFor(token)
        yield* projectStateCache.invalidateForRepo(`${owner}\0${name}`)
        const ctx = {
          tokenSource: "user" as const,
          userId,
          scopeKey: userId,
          repoOwner: owner,
          repoName: name,
          branchName,
          baseBranch
        }
        const base = yield* request(
          { ...ctx, operation: "createBranchAsUser.getBranch" },
          (signal) =>
            octokit.rest.repos.getBranch({
              owner,
              repo: name,
              branch: baseBranch,
              request: { signal }
            }),
          (cause, now) => {
            const err = mapHttpError(cause, now)
            if (err._tag === "RepoGone") {
              return new GitHubError({
                message: `base branch "${baseBranch}" not found`
              })
            }
            return err
          }
        )
        const sha = base.data.commit.sha
        yield* request(
          { ...ctx, operation: "createBranchAsUser.createRef" },
          (signal) =>
            octokit.rest.git.createRef({
              owner,
              repo: name,
              ref: `refs/heads/${branchName}`,
              sha,
              request: { signal, retries: 0 }
            }),
          (cause, now) => mapHttpError(cause, now, { branch: branchName })
        ).pipe(
          Effect.ensuring(
            projectStateCache.invalidateForRepo(`${owner}\0${name}`)
          )
        )
        return { name: branchName, sha }
      }
    )

    const openPullRequestAsUser = Effect.fn("GitHub.openPullRequestAsUser")(
      function* (
        owner: string,
        name: string,
        args: {
          head: string
          base: string
          title: string
          body: string
          draft: boolean
        },
        userId: string
      ) {
        const token = yield* tokenFor(userId)
        const octokit = octokitFor(token)
        yield* projectStateCache.invalidateForRepo(`${owner}\0${name}`)
        const findExisting = request(
          {
            tokenSource: "user",
            scopeKey: userId,
            operation: "openPullRequestAsUser.findExisting",
            repoOwner: owner,
            repoName: name
          },
          async (signal) => {
            const response = await octokit.rest.pulls.list({
              owner,
              repo: name,
              head: `${owner}:${args.head}`,
              base: args.base,
              state: "open",
              per_page: 100,
              request: { signal }
            })
            const existing = response.data.find(
              (pr) =>
                pr.head.ref === args.head &&
                pr.base.ref === args.base &&
                pr.head.repo?.id !== undefined &&
                pr.head.repo.id === pr.base.repo?.id
            )
            return existing
              ? { number: existing.number, url: existing.html_url }
              : null
          },
          narrow([
            "GitHubTokenExpired",
            "GitHubScopeInsufficient",
            "RepoGone",
            "RateLimited"
          ])
        )
        const existing = yield* findExisting
        if (existing) return existing

        return yield* request(
          {
            tokenSource: "user",
            scopeKey: userId,
            operation: "openPullRequestAsUser",
            userId,
            repoOwner: owner,
            repoName: name,
            head: args.head,
            base: args.base,
            draft: args.draft
          },
          (signal) =>
            octokit.rest.pulls.create({
              owner,
              repo: name,
              head: args.head,
              base: args.base,
              title: args.title,
              body: args.body,
              draft: args.draft,
              request: { signal, retries: 0 }
            }),
          (cause, now) => mapHttpError(cause, now, { branch: args.head })
        ).pipe(
          Effect.map((result) => ({
            number: result.data.number,
            url: result.data.html_url
          })),
          Effect.catchTags({
            BranchExists: () =>
              findExisting.pipe(
                Effect.flatMap((existing) =>
                  existing
                    ? Effect.succeed(existing)
                    : Effect.fail(
                        new GitHubError({
                          message: "PR already exists for this branch"
                        })
                      )
                )
              )
          }),
          Effect.ensuring(
            projectStateCache.invalidateForRepo(`${owner}\0${name}`)
          )
        )
      }
    )

    const fetchInstallationProjectStates = Effect.fn(
      "GitHub.fetchInstallationProjectStates"
    )(function* (
      installationId: string,
      owner: string,
      name: string,
      branches: ReadonlyArray<string>,
      branchQuery?: string
    ) {
      const { key, repoKey } = ProjectStateCache.projectStateCacheKey(
        installationId,
        owner,
        name,
        branches,
        branchQuery
      )
      return yield* projectStateCache.cachedProjectStates(
        key,
        installationId,
        repoKey,
        Effect.gen(function* () {
          const token = yield* installationTokenFor(installationId)
          return yield* ProjectState.fetchProjectStatesWithToken(
            token,
            owner,
            name,
            branches,
            "installation",
            branchQuery,
            installationId
          ).pipe(
            Effect.provideService(
              GitHubRequest.GitHubRequestState,
              requestState
            )
          )
        })
      )
    })

    const listInstallationBranches = Effect.fn(
      "GitHub.listInstallationBranches"
    )(function* (
      installationId: string,
      owner: string,
      name: string,
      query: string | undefined,
      first: number
    ) {
      const token = yield* installationTokenFor(installationId)
      return yield* ProjectState.listBranchesWithToken(
        token,
        owner,
        name,
        query,
        first,
        "installation",
        installationId
      ).pipe(
        Effect.provideService(GitHubRequest.GitHubRequestState, requestState)
      )
    })

    const branchExistsInstallation = Effect.fn(
      "GitHub.branchExistsInstallation"
    )(function* (
      installationId: string,
      owner: string,
      name: string,
      branch: string
    ) {
      const token = yield* installationTokenFor(installationId)
      return yield* ProjectState.branchExistsWithToken(
        token,
        owner,
        name,
        branch,
        "installation",
        installationId
      ).pipe(
        Effect.provideService(GitHubRequest.GitHubRequestState, requestState)
      )
    })

    return {
      getInstallationAccount,
      listInstallationRepos,
      verifyInstallationRepo,
      exchangeAppUserCode,
      appUserCanAccessInstallation,
      createBranchAsUser,
      openPullRequestAsUser,
      fetchInstallationProjectStates,
      listInstallationBranches,
      branchExistsInstallation
    } satisfies GitHubShape
  })
)

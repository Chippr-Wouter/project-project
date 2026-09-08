import * as Effect from "effect/Effect"
import * as DateTime from "effect/DateTime"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import {
  BranchListResponse,
  GitHubError,
  RateLimited,
  RepoGone
} from "@projectproject/shared"
import { branchMentionsTicketId } from "../../branchTicketId"
import type {
  ChecksStatus,
  RawBranchEntry,
  RawProjectStates
} from "../../Services/GitHub"
import { graphqlFor } from "./clients"
import { narrow } from "./errors"
import * as GitHubRequest from "./request"

export const PROJECT_STATE_BRANCH_BATCH_SIZE = 20
const PROJECT_STATE_PULL_REQUEST_BATCH_SIZE = 100
const PROJECT_STATE_DISCOVERY_PAGE_LIMIT = 10

const LIST_BRANCHES_QUERY = /* GraphQL */ `
  query ListBranches(
    $owner: String!
    $name: String!
    $q: String
    $first: Int!
  ) {
    repository(owner: $owner, name: $name) {
      refs(
        refPrefix: "refs/heads/"
        query: $q
        first: $first
        orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
      ) {
        nodes {
          name
          branchProtectionRule {
            id
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
`

const BRANCH_EXISTS_QUERY = /* GraphQL */ `
  query BranchExists($owner: String!, $name: String!, $ref: String!) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $ref) {
        name
      }
    }
  }
`

const DISCOVER_BRANCHES_QUERY = /* GraphQL */ `
  query DiscoverBranches(
    $owner: String!
    $name: String!
    $q: String!
    $after: String
  ) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        name
      }
      refs(
        refPrefix: "refs/heads/"
        query: $q
        first: 100
        after: $after
        orderBy: { field: TAG_COMMIT_DATE, direction: DESC }
      ) {
        nodes {
          name
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`

interface BranchRef {
  readonly name: string
}

const PullRequestSchema = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]),
  isDraft: Schema.Boolean,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  headRepository: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  baseRepository: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  mergedAt: Schema.NullOr(Schema.DateFromString),
  commits: Schema.Struct({
    nodes: Schema.Array(
      Schema.Struct({
        commit: Schema.Struct({
          statusCheckRollup: Schema.NullOr(
            Schema.Struct({
              state: Schema.String
            })
          )
        })
      })
    )
  })
})

const PullRequestConnectionSchema = Schema.Struct({
  nodes: Schema.Array(PullRequestSchema),
  pageInfo: Schema.Struct({
    hasNextPage: Schema.Boolean,
    endCursor: Schema.NullOr(Schema.String)
  })
})

type PullRequestNode = typeof PullRequestSchema.Type
type PullRequestConnection = typeof PullRequestConnectionSchema.Type
const decodePullRequestConnection = Schema.decodeUnknownEffect(
  PullRequestConnectionSchema
)

const DiscoveredBranchesResponseSchema = Schema.Struct({
  repository: Schema.NullOr(
    Schema.Struct({
      defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String })),
      refs: Schema.Struct({
        nodes: Schema.Array(Schema.Struct({ name: Schema.String })),
        pageInfo: Schema.Struct({
          hasNextPage: Schema.Boolean,
          endCursor: Schema.NullOr(Schema.String)
        })
      })
    })
  )
})

const decodeDiscoveredBranchesResponse = Schema.decodeUnknownEffect(
  DiscoveredBranchesResponseSchema
)

const FetchProjectStateBatchResponseSchema = Schema.Struct({
  repository: Schema.NullOr(
    Schema.StructWithRest(
      Schema.Struct({
        defaultBranchRef: Schema.NullOr(Schema.Struct({ name: Schema.String }))
      }),
      [Schema.Record(Schema.String, Schema.Unknown)]
    )
  )
})

const decodeFetchProjectStateBatchResponse = Schema.decodeUnknownEffect(
  FetchProjectStateBatchResponseSchema
)

type FetchProjectStateBatchResponse =
  typeof FetchProjectStateBatchResponseSchema.Type

interface ListBranchesResponse {
  readonly repository: {
    readonly refs: {
      readonly nodes: ReadonlyArray<{
        readonly name: string
        readonly branchProtectionRule: { readonly id: string } | null
      }>
      readonly pageInfo: { readonly hasNextPage: boolean }
    }
  } | null
}

interface BranchExistsResponse {
  readonly repository: {
    readonly ref: { readonly name: string } | null
  } | null
}

const mapChecks = (s: string | null | undefined): ChecksStatus => {
  if (!s) return "none"
  if (s === "SUCCESS") return "passing"
  if (
    s === "FAILURE" ||
    s === "ERROR" ||
    s === "TIMED_OUT" ||
    s === "ACTION_REQUIRED" ||
    s === "STARTUP_FAILURE" ||
    s === "CANCELLED"
  )
    return "failing"
  if (
    s === "PENDING" ||
    s === "EXPECTED" ||
    s === "QUEUED" ||
    s === "IN_PROGRESS" ||
    s === "WAITING" ||
    s === "REQUESTED"
  )
    return "pending"
  return "neutral"
}

const isBranchRef = (value: unknown): value is BranchRef =>
  Predicate.isObject(value) && typeof value.name === "string"

const isPullRequestConnection = (
  value: unknown
): value is PullRequestConnection =>
  Predicate.isObject(value) && Array.isArray(value.nodes)

const isSameRepositoryPullRequest = (pr: PullRequestNode): boolean =>
  pr.headRepository?.id !== undefined &&
  pr.headRepository.id === pr.baseRepository?.id

const branchEntryFromParts = (
  existingBranch: string | null,
  pr: PullRequestNode | null | undefined
): {
  readonly existingBranch: string | null
  readonly pr: RawBranchEntry | null
} => {
  return {
    existingBranch,
    pr: pr
      ? {
          headRefName: pr.headRefName,
          baseRefName: pr.baseRefName,
          state:
            pr.state === "MERGED"
              ? "merged"
              : pr.state === "CLOSED"
                ? "closed"
                : "open",
          draft: pr.isDraft,
          number: pr.number,
          url: pr.url,
          title: pr.title,
          mergedAt: pr.mergedAt,
          checks: mapChecks(
            pr.commits.nodes[0]?.commit.statusCheckRollup?.state
          )
        }
      : null
  }
}

export interface ProjectStateBatchResponse {
  readonly branches: ReadonlyArray<string>
  readonly response: FetchProjectStateBatchResponse
}

export const projectStatesFromBatchResponses = (
  data: ReadonlyArray<ProjectStateBatchResponse>
): RawProjectStates | null => {
  const firstRepository = data[0]?.response.repository
  if (!firstRepository) return null

  const branchStates = data.flatMap((batch) => {
    if (!batch.response.repository) return [null]
    return batch.branches.map((branchName, index) => {
      const branch = batch.response.repository?.[`b${index}`]
      const pullRequests = batch.response.repository?.[`p${index}`]
      const existingBranch = isBranchRef(branch) ? branch.name : null
      if (!isPullRequestConnection(pullRequests)) {
        return branchEntryFromParts(existingBranch, null)
      }
      const sameRepoPr = pullRequests.nodes.filter(
        (pr) => pr.headRefName === branchName && isSameRepositoryPullRequest(pr)
      )
      const latestPr =
        sameRepoPr.find((pr) => pr.state === "OPEN") ?? sameRepoPr[0]
      return branchEntryFromParts(existingBranch, latestPr ?? null)
    })
  })
  if (branchStates.some((entry) => entry === null)) return null

  const existingBranches = new Set(
    branchStates.flatMap((entry) =>
      entry?.existingBranch ? [entry.existingBranch] : []
    )
  )
  const prByBranch = new Map<string, RawBranchEntry>()
  for (const entry of branchStates) {
    if (!entry?.pr) continue
    prByBranch.set(entry.pr.headRefName, entry.pr)
  }
  return {
    defaultBranch: firstRepository.defaultBranchRef?.name ?? "main",
    existingBranches,
    prByBranch
  }
}

export const buildProjectStateBatchQuery = (
  branches: ReadonlyArray<string>,
  cursors: ReadonlyMap<string, string> = new Map()
): {
  readonly query: string
  readonly variables: Record<string, string | null>
} => {
  const variableDefinitions = branches.flatMap((branch, index) => [
    `$ref${index}: String!`,
    `$headRefName${index}: String!`,
    ...(cursors.has(branch) ? [`$cursor${index}: String`] : [])
  ])
  const branchFields = branches.map(
    (branch, index) => `
      b${index}: ref(qualifiedName: $ref${index}) {
        name
      }
      p${index}: pullRequests(
        states: [OPEN, MERGED, CLOSED]
        headRefName: $headRefName${index}
        first: ${PROJECT_STATE_PULL_REQUEST_BATCH_SIZE}
        ${cursors.has(branch) ? `after: $cursor${index}` : ""}
        orderBy: { field: UPDATED_AT, direction: DESC }
      ) {
        nodes {
          number
          title
          url
          state
          isDraft
          headRefName
          baseRefName
          headRepository {
            id
          }
          baseRepository {
            id
          }
          mergedAt
          commits(last: 1) {
            nodes {
              commit {
                statusCheckRollup {
                  state
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }`
  )
  const query = `
    query FetchProjectStateBatch(
      $owner: String!
      $name: String!
      ${variableDefinitions.join("\n")}
    ) {
      repository(owner: $owner, name: $name) {
        defaultBranchRef {
          name
        }
        ${branchFields.join("\n")}
      }
    }
  `
  const variables = branches.reduce<Record<string, string | null>>(
    (accumulator, branch, index) => {
      accumulator[`ref${index}`] = `refs/heads/${branch}`
      accumulator[`headRefName${index}`] = branch
      if (cursors.has(branch)) {
        accumulator[`cursor${index}`] = cursors.get(branch) ?? null
      }
      return accumulator
    },
    {}
  )

  return { query, variables }
}

const branchChunks = (branches: ReadonlyArray<string>) => {
  const chunks: Array<ReadonlyArray<string>> = []
  for (
    let index = 0;
    index < branches.length;
    index += PROJECT_STATE_BRANCH_BATCH_SIZE
  ) {
    chunks.push(branches.slice(index, index + PROJECT_STATE_BRANCH_BATCH_SIZE))
  }
  return chunks.length > 0 ? chunks : [[]]
}

const branchListFromResponse = (
  data: ListBranchesResponse
): BranchListResponse | null => {
  if (!data.repository) return null
  return {
    items: data.repository.refs.nodes.map((n) => ({
      name: n.name,
      isProtected: n.branchProtectionRule !== null
    })),
    hasMore: data.repository.refs.pageInfo.hasNextPage
  }
}

export const fetchProjectStatesWithToken = (
  token: string,
  owner: string,
  name: string,
  branches: ReadonlyArray<string>,
  tokenSource: "user" | "installation",
  branchQuery?: string,
  scopeKey?: string
): Effect.Effect<
  RawProjectStates,
  RepoGone | RateLimited | GitHubError,
  GitHubRequest.GitHubRequestState
> =>
  Effect.gen(function* () {
    const fetchedAt = yield* DateTime.nowAsDate
    const gql = graphqlFor(token)
    let requestedBranches = [...new Set(branches)]
    if (branchQuery !== undefined) {
      const discoveredBranches: Array<string> = []
      const seenCursors = new Set<string>()
      let after: string | null = null
      let defaultBranch: string | null = null
      let discoveryPages = 0
      do {
        const response = yield* GitHubRequest.githubRequest(
          {
            tokenSource,
            scopeKey,
            operation: "discoverProjectBranches",
            repoOwner: owner,
            repoName: name,
            query: branchQuery,
            first: 100
          },
          (signal) =>
            gql<unknown>(DISCOVER_BRANCHES_QUERY, {
              owner,
              name,
              q: branchQuery,
              after,
              request: { signal }
            }),
          narrow(["RepoGone", "RateLimited"] as const)
        )
        const decoded = yield* decodeDiscoveredBranchesResponse(response).pipe(
          Effect.mapError((cause) =>
            GitHubError.invalidResponse("discoverProjectBranches", cause)
          )
        )
        const repository = decoded.repository
        if (!repository) return yield* new RepoGone()
        defaultBranch ??= repository.defaultBranchRef?.name ?? "main"
        discoveredBranches.push(
          ...repository.refs.nodes.map((branch) => branch.name)
        )
        const pageInfo = repository.refs.pageInfo
        if (!pageInfo.hasNextPage) break
        discoveryPages += 1
        if (discoveryPages >= PROJECT_STATE_DISCOVERY_PAGE_LIMIT) {
          return yield* new GitHubError({
            message: "GitHub branch discovery exceeded the page limit"
          })
        }
        if (!pageInfo.endCursor) {
          return yield* new GitHubError({
            message: "GitHub returned a branch page without a cursor"
          })
        }
        if (seenCursors.has(pageInfo.endCursor)) {
          return yield* new GitHubError({
            message: "GitHub returned a repeated branch page cursor"
          })
        }
        seenCursors.add(pageInfo.endCursor)
        after = pageInfo.endCursor
      } while (true)

      const explicitBranches = new Set(requestedBranches)
      requestedBranches = [
        ...new Set([
          ...requestedBranches,
          ...discoveredBranches.filter(
            (branch) =>
              explicitBranches.has(branch) ||
              (branch !== defaultBranch && branchMentionsTicketId(branch))
          )
        ])
      ]
    }
    const distinctBranches = requestedBranches
    const batches = yield* Effect.forEach(
      branchChunks(distinctBranches),
      (batchBranches) =>
        Effect.gen(function* () {
          const pullRequestsByBranch = new Map<string, Array<PullRequestNode>>()
          const cursors = new Map<string, string>()
          const seenCursors = new Map<string, Set<string>>()
          let pendingBranches = batchBranches
          let firstResponse: FetchProjectStateBatchResponse | undefined

          do {
            const batch = buildProjectStateBatchQuery(pendingBranches, cursors)
            const response = yield* GitHubRequest.githubRequest(
              {
                tokenSource,
                scopeKey,
                operation: "fetchProjectStateBatch",
                repoOwner: owner,
                repoName: name,
                branches: pendingBranches.length
              },
              (signal) =>
                gql<unknown>(batch.query, {
                  owner,
                  name,
                  ...batch.variables,
                  request: { signal }
                }),
              narrow(["RepoGone", "RateLimited"] as const)
            )
            const decodedResponse = yield* decodeFetchProjectStateBatchResponse(
              response
            ).pipe(
              Effect.mapError((cause) =>
                GitHubError.invalidResponse("fetchProjectStateBatch", cause)
              )
            )
            firstResponse ??= decodedResponse

            if (!decodedResponse.repository) return yield* new RepoGone()

            const nextPendingBranches: Array<string> = []
            for (const [index, branch] of pendingBranches.entries()) {
              const pullRequests = decodedResponse.repository[`p${index}`]
              const decodedPullRequests = yield* decodePullRequestConnection(
                pullRequests
              ).pipe(
                Effect.mapError((cause) =>
                  GitHubError.invalidResponse("fetchProjectStateBatch", cause)
                )
              )

              const existing = pullRequestsByBranch.get(branch) ?? []
              pullRequestsByBranch.set(branch, [
                ...existing,
                ...decodedPullRequests.nodes.filter(
                  (pr) =>
                    pr.headRefName === branch && isSameRepositoryPullRequest(pr)
                )
              ])

              const hasSameRepositoryOpenPr = decodedPullRequests.nodes.some(
                (pr) =>
                  pr.headRefName === branch &&
                  isSameRepositoryPullRequest(pr) &&
                  pr.state === "OPEN"
              )
              const pageInfo = decodedPullRequests.pageInfo
              if (!hasSameRepositoryOpenPr && pageInfo.hasNextPage) {
                const endCursor = pageInfo.endCursor
                const branchCursors = seenCursors.get(branch) ?? new Set()
                if (!endCursor) {
                  return yield* new GitHubError({
                    message: "GitHub returned a page without a cursor"
                  })
                }
                if (branchCursors.has(endCursor)) {
                  return yield* new GitHubError({
                    message: "GitHub returned a repeated page cursor"
                  })
                }
                branchCursors.add(endCursor)
                seenCursors.set(branch, branchCursors)
                cursors.set(branch, endCursor)
                nextPendingBranches.push(branch)
              }
            }
            pendingBranches = nextPendingBranches
          } while (pendingBranches.length > 0)

          const repository = firstResponse.repository
          if (!repository) return yield* new RepoGone()

          const responseRepository = { ...repository }
          for (const [index, branch] of batchBranches.entries()) {
            responseRepository[`p${index}`] = {
              nodes: pullRequestsByBranch.get(branch) ?? []
            }
          }
          return {
            branches: batchBranches,
            response: { ...firstResponse, repository: responseRepository }
          }
        }),
      { concurrency: 2 }
    )

    const result = projectStatesFromBatchResponses(batches)
    if (!result) return yield* new RepoGone()
    return { ...result, fetchedAt }
  })

export const listBranchesWithToken = (
  token: string,
  owner: string,
  name: string,
  query: string | undefined,
  first: number,
  tokenSource: "user" | "installation",
  scopeKey?: string
): Effect.Effect<
  BranchListResponse,
  RepoGone | RateLimited | GitHubError,
  GitHubRequest.GitHubRequestState
> =>
  Effect.gen(function* () {
    const gql = graphqlFor(token)
    const data = yield* GitHubRequest.githubRequest(
      {
        tokenSource,
        scopeKey,
        operation: "listBranches",
        repoOwner: owner,
        repoName: name,
        query: query ?? null,
        first
      },
      (signal) =>
        gql<ListBranchesResponse>(LIST_BRANCHES_QUERY, {
          owner,
          name,
          q: query ?? null,
          first,
          request: { signal }
        }),
      narrow(["RepoGone", "RateLimited"] as const)
    )
    const result = branchListFromResponse(data)
    if (!result) return yield* new RepoGone()
    return result
  })

export const branchExistsWithToken = (
  token: string,
  owner: string,
  name: string,
  branch: string,
  tokenSource: "user" | "installation",
  scopeKey?: string
): Effect.Effect<
  boolean,
  RepoGone | RateLimited | GitHubError,
  GitHubRequest.GitHubRequestState
> =>
  Effect.gen(function* () {
    const gql = graphqlFor(token)
    const data = yield* GitHubRequest.githubRequest(
      {
        tokenSource,
        scopeKey,
        operation: "branchExists",
        repoOwner: owner,
        repoName: name,
        branch
      },
      (signal) =>
        gql<BranchExistsResponse>(BRANCH_EXISTS_QUERY, {
          owner,
          name,
          ref: `refs/heads/${branch}`,
          request: { signal }
        }),
      narrow(["RepoGone", "RateLimited"] as const)
    )
    if (!data.repository) return yield* new RepoGone()
    return data.repository.ref !== null
  })

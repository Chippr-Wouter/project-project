import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import {
  BranchListResponse,
  GitHubError,
  RateLimited,
  RepoGone
} from "@projectproject/shared"
import type { RawBranchEntry, RawProjectStates } from "../../Services/GitHub"
import { graphqlFor } from "./clients"
import { narrow } from "./errors"
import { githubRequest } from "./request"

export const PROJECT_STATE_BRANCH_BATCH_SIZE = 20

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

interface BranchRef {
  readonly name: string
}

interface PullRequestNode {
  readonly number: number
  readonly title: string
  readonly url: string
  readonly state: "OPEN" | "CLOSED" | "MERGED"
  readonly isDraft: boolean
  readonly headRefName: string
  readonly baseRefName: string
  readonly headRepository: { readonly id: string } | null
  readonly baseRepository: { readonly id: string } | null
  readonly mergedAt: string | null
  readonly commits: {
    readonly nodes: ReadonlyArray<{
      readonly commit: {
        readonly statusCheckRollup: { readonly state: string } | null
      }
    }>
  }
}

interface PullRequestConnection {
  readonly nodes: ReadonlyArray<PullRequestNode>
}

interface FetchProjectStateBatchResponse {
  readonly repository:
    | ({
        readonly defaultBranchRef: BranchRef | null
      } & {
        readonly [key: string]:
          | BranchRef
          | PullRequestConnection
          | null
          | undefined
      })
    | null
}

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

const mapChecks = (s: string | null | undefined): RawBranchEntry["checks"] => {
  if (!s) return "none"
  if (s === "SUCCESS") return "passing"
  if (s === "FAILURE" || s === "ERROR") return "failing"
  if (s === "PENDING" || s === "EXPECTED") return "pending"
  return "neutral"
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const isBranchRef = (value: unknown): value is BranchRef =>
  isRecord(value) && typeof value.name === "string"

const isPullRequestConnection = (
  value: unknown
): value is PullRequestConnection =>
  isRecord(value) && Array.isArray(value.nodes)

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
          mergedAt: pr.mergedAt
            ? DateTime.toDate(DateTime.makeUnsafe(pr.mergedAt))
            : null,
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
    return batch.branches.map((_, index) => {
      const branch = batch.response.repository?.[`b${index}`]
      const pullRequests = batch.response.repository?.[`p${index}`]
      const existingBranch = isBranchRef(branch) ? branch.name : null
      if (!isPullRequestConnection(pullRequests)) {
        return branchEntryFromParts(existingBranch, null)
      }
      const sameRepoPr = pullRequests.nodes.find(
        (pr) =>
          pr.headRepository?.id !== undefined &&
          pr.headRepository.id === pr.baseRepository?.id
      )
      return branchEntryFromParts(existingBranch, sameRepoPr ?? null)
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
  branches: ReadonlyArray<string>
): {
  readonly query: string
  readonly variables: Record<string, string>
} => {
  const variableDefinitions = branches.flatMap((_, index) => [
    `$ref${index}: String!`,
    `$headRefName${index}: String!`
  ])
  const branchFields = branches.map(
    (_, index) => `
      b${index}: ref(qualifiedName: $ref${index}) {
        name
      }
      p${index}: pullRequests(
        states: [OPEN, MERGED, CLOSED]
        headRefName: $headRefName${index}
        first: 10
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
  const variables = branches.reduce<Record<string, string>>(
    (accumulator, branch, index) => {
      accumulator[`ref${index}`] = `refs/heads/${branch}`
      accumulator[`headRefName${index}`] = branch
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
  tokenSource: "user" | "installation"
): Effect.Effect<RawProjectStates, RepoGone | RateLimited | GitHubError> =>
  Effect.gen(function* () {
    const gql = graphqlFor(token)
    const distinctBranches = [...new Set(branches)]
    const batches = yield* Effect.forEach(
      branchChunks(distinctBranches),
      (batchBranches) => {
        const batch = buildProjectStateBatchQuery(batchBranches)
        return Effect.map(
          githubRequest(
            {
              tokenSource,
              operation: "fetchProjectStateBatch",
              repoOwner: owner,
              repoName: name,
              branches: batchBranches.length
            },
            (signal) =>
              gql<FetchProjectStateBatchResponse>(batch.query, {
                owner,
                name,
                ...batch.variables,
                request: { signal }
              }),
            narrow(["RepoGone", "RateLimited"] as const)
          ),
          (response) => ({ branches: batchBranches, response })
        )
      },
      { concurrency: 2 }
    )

    const result = projectStatesFromBatchResponses(batches)
    if (!result) return yield* new RepoGone()
    return result
  })

export const listBranchesWithToken = (
  token: string,
  owner: string,
  name: string,
  query: string | undefined,
  first: number,
  tokenSource: "user" | "installation"
): Effect.Effect<BranchListResponse, RepoGone | RateLimited | GitHubError> =>
  Effect.gen(function* () {
    const gql = graphqlFor(token)
    const data = yield* githubRequest(
      {
        tokenSource,
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
  tokenSource: "user" | "installation"
): Effect.Effect<boolean, RepoGone | RateLimited | GitHubError> =>
  Effect.gen(function* () {
    const gql = graphqlFor(token)
    const data = yield* githubRequest(
      {
        tokenSource,
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

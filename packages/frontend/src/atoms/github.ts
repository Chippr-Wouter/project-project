import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Option from "effect/Option"
// GitHub-related atoms.
//
// The mutation atoms here use the project's optimistic-update pattern (see
// CLAUDE.md "Mutations and optimistic updates"): split the read into a
// private `xBaseAtom` + a public `xAtom = Atom.optimistic(xBase)`, then write
// mutations as `Atom.optimisticFn(xAtom, { reducer, fn })`.
//
// Family keys: every project-scoped atom is keyed on `${orgSlug}/${slug}`.
// Slugs are URL-safe (no `/`), so a slash is an unambiguous separator.

import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Effect from "effect/Effect"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import type {
  AttachBranchInput,
  ConnectGithubInput,
  CreateBranchInput,
  GitState,
  GitStatesResponse,
  TicketId,
  Slug
} from "@projectproject/shared"
import { projectAtom, projectBaseAtom } from "./projects"

export const githubAuthEpochAtom = Atom.make(0)

type BranchPendingOperation = "create" | "connect"

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const sep = key.indexOf("/")
  return { orgSlug: key.slice(0, sep), slug: key.slice(sep + 1) }
}

export const shouldInvalidateTicketsForGitStates = (
  states: Pick<GitStatesResponse, "transitioned"> &
    Partial<Pick<GitStatesResponse, "changedTicketIds">>
) =>
  states.transitioned.length > 0 || (states.changedTicketIds?.length ?? 0) > 0

export const mergeStaleGitStateDetails = (
  previous: GitStatesResponse | undefined,
  next: GitStatesResponse,
  repoChanged: boolean
): GitStatesResponse => {
  if (repoChanged || !previous || next.repoStatus === "not_connected") {
    return next
  }
  const preserveDetails = next.refreshStatus !== "fresh"
  const preserveStaleSummary =
    next.refreshStatus === "stale" || next.refreshStatus === "rate_limited"
  const states = Object.fromEntries(
    Object.entries(next.states).map(([ticketId, state]) => {
      const prior = previous.states[ticketId]
      if (
        preserveDetails &&
        state.tag === "pr_open" &&
        prior?.tag === "pr_open" &&
        state.branch === prior.branch &&
        state.number === prior.number
      ) {
        return [
          ticketId,
          {
            ...state,
            title:
              preserveStaleSummary && !state.title ? prior.title : state.title,
            checks:
              preserveStaleSummary && state.checks === "none"
                ? prior.checks
                : state.checks
          }
        ]
      }
      if (
        (next.refreshStatus === "stale" ||
          next.refreshStatus === "rate_limited") &&
        state.tag === "branch_pending" &&
        prior?.tag === "pr_open" &&
        state.name === prior.branch
      ) {
        return [ticketId, prior]
      }
      return [ticketId, state]
    })
  )
  return { ...next, states }
}

const gitStateIdentity = (state: GitState): string => {
  switch (state.tag) {
    case "branch_no_pr":
    case "branch_pending":
    case "stale_branch":
      return `${state.tag}:${state.name}`
    case "pr_closed":
    case "pr_merged":
    case "pr_open":
    case "pr_pending":
      return `${state.tag}:${state.branch}:${state.number}`
    case "no_branch":
      return state.tag
  }
}

export const changedGitStateTicketIds = (
  previous: GitStatesResponse | undefined,
  next: GitStatesResponse
): ReadonlyArray<string> => {
  if (!previous) return []
  const ticketIds = new Set([
    ...Object.keys(previous.states),
    ...Object.keys(next.states)
  ])
  return [...ticketIds].filter((ticketId) => {
    const before = previous.states[ticketId]
    const after = next.states[ticketId]
    if (!before) return after?.tag !== "no_branch"
    if (!after) return true
    return gitStateIdentity(before) !== gitStateIdentity(after)
  })
}

export const projectGitStatesBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  let lastRepoId: string | null | undefined
  let previous: GitStatesResponse | undefined
  return runtime
    .atom((get) => {
      get(githubAuthEpochAtom)
      const projectResult = get(projectBaseAtom(key))
      const project = Option.getOrUndefined(Result.value(projectResult))
      const repoId =
        project === undefined ? undefined : (project.github?.repoId ?? null)
      return Effect.gen(function* () {
        const client = yield* ApiClient
        const response = yield* client.projects.gitStates({
          params: { orgSlug, slug }
        })
        const prior = previous
        const states = mergeStaleGitStateDetails(
          prior,
          response,
          repoId !== undefined &&
            lastRepoId !== undefined &&
            repoId !== lastRepoId
        )
        previous = states
        if (repoId !== undefined) lastRepoId = repoId
        const changedStateIds = changedGitStateTicketIds(prior, states)
        const shouldInvalidate =
          shouldInvalidateTicketsForGitStates(response) ||
          changedStateIds.length > 0
        if (shouldInvalidate) {
          yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        }
        return states
      })
    })
    .pipe(Atom.setIdleTTL("30 seconds"))
})

export const projectGitStatesAtom = Atom.family((key: string) =>
  Atom.optimistic(projectGitStatesBaseAtom(key))
)

export const githubOrgIntegrationAtom = Atom.family((orgSlug: string) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.projects.githubIntegration({
          params: { orgSlug }
        })
      })
    )
    .pipe(Atom.setIdleTTL("1 minute"))
)

const splitOrgRepoKey = (key: string): { orgSlug: string; query: string } => {
  const sep = key.indexOf(" ")
  return { orgSlug: key.slice(0, sep), query: key.slice(sep + 1) }
}

type CreateBranchMutationInput = { id: TicketId } & Omit<
  CreateBranchInput,
  "baseBranch"
> & {
    baseBranch: string
  }

const gitStateBaseBranch = (
  state: GitState | undefined,
  fallback: string
): string => {
  if (state?.tag === "no_branch" && state.baseBranch) return state.baseBranch
  if (state?.tag === "branch_no_pr") return state.baseBranch
  if (state?.tag === "branch_pending") return state.baseBranch
  if (state?.tag === "pr_pending") return state.baseBranch
  if (state?.tag === "pr_open") return state.baseBranch
  if (state?.tag === "pr_merged") return state.baseBranch
  if (state?.tag === "pr_closed") return state.baseBranch
  return fallback
}

const optimisticBranchPending = (
  name: string,
  baseBranch: string,
  operation: BranchPendingOperation
): GitState => ({
  tag: "branch_pending",
  name,
  baseBranch,
  pendingOperation: operation
})

export const githubInstallationReposKey = (orgSlug: string, query: string) =>
  `${orgSlug} ${query}`

export const githubInstallationReposAtom = Atom.family((key: string) =>
  runtime
    .atom((get) => {
      const { orgSlug, query } = splitOrgRepoKey(key)
      get(githubAuthEpochAtom)
      get(githubOrgIntegrationAtom(orgSlug))
      return Effect.gen(function* () {
        const client = yield* ApiClient
        const q = query.trim() ? query.trim() : undefined
        const first = yield* client.projects.listGithubInstallationRepos({
          params: { orgSlug },
          query: { q, page: 1 }
        })
        if (!q || !first.hasMore) return first
        const repos = [...first.repos]
        let hasMore: boolean = first.hasMore
        let page = 2
        while (hasMore) {
          const next = yield* client.projects.listGithubInstallationRepos({
            params: { orgSlug },
            query: { q, page }
          })
          repos.push(...next.repos)
          hasMore = next.hasMore
          page += 1
        }
        return { repos, hasMore: false }
      })
    })
    .pipe(Atom.setIdleTTL("2 minutes"))
)

export const branchesKey = (
  orgSlug: string,
  slug: string,
  repoId: string,
  q: string
) => `${orgSlug}/${slug} ${repoId} ${q}`

export const branchesAtom = Atom.family((key: string) => {
  const firstSep = key.indexOf(" ")
  const secondSep = key.indexOf(" ", firstSep + 1)
  const projKey = key.slice(0, firstSep)
  const { orgSlug, slug } = splitProjectKey(projKey)
  return runtime
    .atom((get) => {
      get(githubAuthEpochAtom)
      get(projectBaseAtom(projKey))
      return Effect.gen(function* () {
        const q = key.slice(secondSep + 1)
        const client = yield* ApiClient
        return yield* client.projects.listBranches({
          params: { orgSlug, slug },
          query: { q: q.trim() ? q.trim() : undefined }
        })
      })
    })
    .pipe(
      Atom.withReactivity(["branches", orgSlug, slug]),
      Atom.setIdleTTL("1 minute")
    )
})

// --- Mutations -----------------------------------------------------------

export const connectGithubAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectAtom(key), {
    reducer: (current, input: ConnectGithubInput) =>
      Result.isSuccess(current)
        ? Result.success(
            {
              ...current.value,
              github: {
                repoId: input.repoId,
                repoOwner: input.repoOwner,
                repoName: input.repoName,
                defaultBaseBranch: input.defaultBaseBranch ?? null
              }
            },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: ConnectGithubInput, get) {
        const client = yield* ApiClient
        const updated = yield* client.projects.connectGithub({
          params: { orgSlug, slug },
          payload: input
        })
        get.refresh(projectBaseAtom(key))
        get.refresh(projectGitStatesBaseAtom(key))
        yield* Reactivity.invalidate(["branches", orgSlug, slug])
        return updated
      })
    )
  })
})

export const startGithubInstallAtom = Atom.family((orgSlug: string) =>
  runtime.fn(
    Effect.fn(function* (input: { returnProjectSlug?: Slug }, get) {
      const client = yield* ApiClient
      const response = yield* client.projects.startGithubInstall({
        params: { orgSlug },
        payload: { returnProjectSlug: input.returnProjectSlug ?? null }
      })
      get.refresh(githubOrgIntegrationAtom(orgSlug))
      return response
    })
  )
)

export const disconnectGithubAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectAtom(key), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success({ ...current.value, github: null }, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        const updated = yield* client.projects.disconnectGithub({
          params: { orgSlug, slug }
        })
        get.refresh(projectBaseAtom(key))
        get.refresh(projectGitStatesBaseAtom(key))
        yield* Reactivity.invalidate(["branches", orgSlug, slug])
        return updated
      })
    )
  })
})

export const createBranchAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectGitStatesAtom(key), {
    reducer: (current, input: CreateBranchMutationInput) => {
      const optimistic = optimisticBranchPending(
        input.name,
        input.baseBranch,
        "create"
      )
      if (!Result.isSuccess(current)) {
        return Result.success(
          {
            states: { [input.id]: optimistic },
            transitioned: [],
            tokenStatus: "ok",
            repoStatus: "ok"
          },
          { waiting: true }
        )
      }
      return Result.success(
        {
          ...current.value,
          states: { ...current.value.states, [input.id]: optimistic }
        },
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (input: CreateBranchMutationInput, get) {
        const client = yield* ApiClient
        const updated = yield* client.tickets.createBranch({
          params: { orgSlug, slug, id: input.id },
          payload: { name: input.name, baseBranch: input.baseBranch }
        })
        get.refresh(projectGitStatesBaseAtom(key))
        yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        yield* Reactivity.invalidate(["branches", orgSlug, slug])
        return updated
      })
    )
  })
})

export const attachBranchAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectGitStatesAtom(key), {
    reducer: (current, input: { id: TicketId } & AttachBranchInput) => {
      const baseBranch = Result.isSuccess(current)
        ? gitStateBaseBranch(current.value.states[input.id], "")
        : ""
      const optimistic = optimisticBranchPending(
        input.name,
        baseBranch,
        "connect"
      )
      if (!Result.isSuccess(current)) {
        return Result.success(
          {
            states: { [input.id]: optimistic },
            transitioned: [],
            tokenStatus: "ok",
            repoStatus: "ok"
          },
          { waiting: true }
        )
      }
      return Result.success(
        {
          ...current.value,
          states: { ...current.value.states, [input.id]: optimistic }
        },
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (input: { id: TicketId } & AttachBranchInput, get) {
        const client = yield* ApiClient
        const updated = yield* client.tickets.attachBranch({
          params: { orgSlug, slug, id: input.id },
          payload: { name: input.name }
        })
        get.refresh(projectGitStatesBaseAtom(key))
        yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        return updated
      })
    )
  })
})

export const clearBranchAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectGitStatesAtom(key), {
    reducer: (current, input: { id: TicketId }) => {
      if (!Result.isSuccess(current)) return current
      const baseBranch = gitStateBaseBranch(current.value.states[input.id], "")
      const optimistic: GitState = baseBranch
        ? { tag: "no_branch", baseBranch }
        : { tag: "no_branch" }
      return Result.success(
        {
          ...current.value,
          states: { ...current.value.states, [input.id]: optimistic }
        },
        { waiting: true }
      )
    },
    fn: runtime.fn(
      Effect.fn(function* (input: { id: TicketId }, get) {
        const client = yield* ApiClient
        const updated = yield* client.tickets.clearBranch({
          params: { orgSlug, slug, id: input.id }
        })
        yield* Reactivity.invalidate([`tickets/${orgSlug}/${slug}`])
        get.refresh(projectGitStatesBaseAtom(key))
        return updated
      })
    )
  })
})

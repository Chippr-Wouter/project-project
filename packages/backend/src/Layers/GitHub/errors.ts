import * as Predicate from "effect/Predicate"
import {
  BranchExists,
  BranchProtected,
  GitHubError,
  GitHubScopeInsufficient,
  GitHubTokenExpired,
  RateLimited,
  RepoGone
} from "@projectproject/shared"

export type GitHubFailure =
  | GitHubTokenExpired
  | GitHubScopeInsufficient
  | RepoGone
  | BranchExists
  | BranchProtected
  | RateLimited
  | GitHubError

const HTTP_STATUS_KEY = "status"

export const githubErrorMessage = (cause: unknown): string => {
  if (!Predicate.isObject(cause)) return "GitHub error"
  const message = cause.message
  return Predicate.isString(message) ? message : "GitHub error"
}

const header = (
  headers: { readonly [key: PropertyKey]: unknown } | undefined,
  name: string
): string | undefined => {
  const found = headers
    ? Object.entries(headers).find(([key]) => key.toLowerCase() === name)
    : undefined
  return found && Predicate.isString(found[1]) ? found[1] : undefined
}

const parseRetryAfter = (
  value: string | undefined,
  nowSeconds: number
): number | undefined => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/u.test(trimmed)) {
    const seconds = Number(trimmed)
    const retryAt = nowSeconds + seconds
    return Number.isSafeInteger(retryAt) ? retryAt : undefined
  }
  const timestamp = Date.parse(trimmed)
  if (!Number.isFinite(timestamp)) return undefined
  const retryAt = timestamp / 1_000
  return retryAt > nowSeconds ? retryAt : undefined
}

const graphqlErrorCodes = (error: {
  readonly [key: PropertyKey]: unknown
}): ReadonlyArray<string> => {
  const errors = error.errors
  if (!Array.isArray(errors)) return []
  return errors.flatMap((entry) => {
    if (!Predicate.isObject(entry)) return []
    const extensions = entry.extensions
    const code = Predicate.isObject(extensions) ? extensions.code : undefined
    return [entry.type, code].filter(Predicate.isString)
  })
}

const isAllowedFailure = <
  const Allow extends ReadonlyArray<GitHubFailure["_tag"]>
>(
  err: GitHubFailure,
  allow: Allow
): err is Extract<GitHubFailure, { _tag: Allow[number] }> =>
  allow.some((tag) => tag === err._tag)

export function mapHttpError(
  cause: unknown,
  nowSeconds: number,
  context?: { readonly branch?: string }
): GitHubFailure {
  const err = Predicate.isObject(cause) ? cause : undefined
  const statusValue = err?.[HTTP_STATUS_KEY]
  const response = Predicate.isObject(err?.response) ? err.response : undefined
  const responseStatus = response?.[HTTP_STATUS_KEY]
  const status = Predicate.isNumber(statusValue)
    ? statusValue
    : Predicate.isNumber(responseStatus)
      ? responseStatus
      : undefined
  const message = githubErrorMessage(cause)
  const headers = Predicate.isObject(response?.headers)
    ? response.headers
    : err && Predicate.isObject(err.headers)
      ? err.headers
      : undefined
  const retryAfter = parseRetryAfter(header(headers, "retry-after"), nowSeconds)
  const resetHeader = header(headers, "x-ratelimit-reset")
  const parsedResetAt = resetHeader ? Number(resetHeader) : undefined
  const resetAt =
    parsedResetAt !== undefined && Number.isFinite(parsedResetAt)
      ? parsedResetAt
      : nowSeconds + 60
  const rateLimitResetAt = retryAfter ?? resetAt
  const remaining = header(headers, "x-ratelimit-remaining")
  const remainingIsZero = remaining !== undefined && Number(remaining) === 0
  const graphqlCodes = err ? graphqlErrorCodes(err) : []
  const graphqlNotFound = graphqlCodes.includes("NOT_FOUND")
  const graphqlRateLimited = graphqlCodes.includes("RATE_LIMITED")

  if (status === 401) return new GitHubTokenExpired()
  if (status === 403) {
    if (
      remainingIsZero ||
      retryAfter !== undefined ||
      /rate.?limit|abuse/i.test(message)
    ) {
      return new RateLimited({
        resetAt: rateLimitResetAt
      })
    }
    return new GitHubScopeInsufficient()
  }
  if (status === 404 || graphqlNotFound) return new RepoGone()
  if (status === 422) {
    if (/already exists/i.test(message)) {
      return context?.branch
        ? new BranchExists({ branch: context.branch })
        : new GitHubError({ message })
    }
    if (/protected/i.test(message)) {
      return context?.branch
        ? new BranchProtected({ branch: context.branch })
        : new GitHubError({ message })
    }
    return new GitHubError({ message })
  }
  if (status === 429) {
    return new RateLimited({
      resetAt: rateLimitResetAt
    })
  }
  if (graphqlRateLimited) return new RateLimited({ resetAt: rateLimitResetAt })
  return new GitHubError({ message })
}

export type TaggedFailure = { readonly _tag: string }

export const narrow =
  <const Allow extends ReadonlyArray<GitHubFailure["_tag"]>>(allow: Allow) =>
  (
    cause: unknown,
    nowSecs: number
  ):
    | Extract<GitHubFailure, { _tag: Allow[number] }>
    | RateLimited
    | GitHubError => {
    const err = mapHttpError(cause, nowSecs)
    if (err._tag === "RateLimited") return err
    if (isAllowedFailure(err, allow)) return err
    return new GitHubError({ message: err._tag })
  }

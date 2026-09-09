import { expect, it } from "vite-plus/test"
import { mapHttpError } from "./errors"

const nowSeconds = 1_000

it("maps existing branch errors with branch context", () => {
  const error = mapHttpError(
    { status: 422, message: "Reference already exists" },
    nowSeconds,
    { branch: "feat/T-1-test" }
  )

  expect(error._tag).toBe("BranchExists")
  if (error._tag === "BranchExists") {
    expect(error.branch).toBe("feat/T-1-test")
  }
})

it("maps protected branch errors with branch context", () => {
  const error = mapHttpError(
    { status: 422, message: "protected branch hook declined" },
    nowSeconds,
    { branch: "main" }
  )

  expect(error._tag).toBe("BranchProtected")
  if (error._tag === "BranchProtected") {
    expect(error.branch).toBe("main")
  }
})

it("does not fabricate an empty branch when context is missing", () => {
  const error = mapHttpError(
    { status: 422, message: "Reference already exists" },
    nowSeconds
  )

  expect(error._tag).toBe("GitHubError")
})

it("maps exhausted 403 responses to a rate limit", () => {
  const error = mapHttpError(
    {
      status: 403,
      message: "Resource unavailable",
      response: {
        headers: {
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": "2000"
        }
      }
    },
    nowSeconds
  )

  expect(error._tag).toBe("RateLimited")
  if (error._tag === "RateLimited") expect(error.resetAt).toBe(2000)
})

it("prefers Retry-After over the rate limit reset header", () => {
  const error = mapHttpError(
    {
      status: 429,
      response: {
        headers: {
          "retry-after": "10",
          "x-ratelimit-reset": "2000"
        }
      }
    },
    nowSeconds
  )

  expect(error._tag).toBe("RateLimited")
  if (error._tag === "RateLimited") expect(error.resetAt).toBe(1010)
})

it("maps GraphQL not-found errors returned with HTTP 200", () => {
  const error = mapHttpError(
    {
      errors: [
        { type: "NOT_FOUND", message: "Could not resolve to a Repository" }
      ]
    },
    nowSeconds
  )

  expect(error._tag).toBe("RepoGone")
})

it("maps GraphQL rate-limit errors returned with HTTP 200", () => {
  const error = mapHttpError(
    {
      errors: [{ type: "RATE_LIMITED", message: "Something went wrong" }],
      headers: { "retry-after": "Thu, 01 Jan 1970 00:20:00 GMT" }
    },
    nowSeconds
  )

  expect(error._tag).toBe("RateLimited")
  if (error._tag === "RateLimited") expect(error.resetAt).toBe(1200)
})

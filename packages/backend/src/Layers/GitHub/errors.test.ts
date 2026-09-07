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

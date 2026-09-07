import { describe, expect, it } from "vite-plus/test"
import {
  Forbidden,
  NotFound,
  Unauthorized,
  Validation
} from "@projectproject/shared"
import { mapToolError } from "./errorMap"

describe("mapToolError", () => {
  it("maps Unauthorized to a structured isError result", () => {
    const result = mapToolError(new Unauthorized())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Unauthorized")
  })

  it("maps NotFound to Not found", () => {
    const result = mapToolError(new NotFound())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Not found")
  })

  it("maps Forbidden", () => {
    const result = mapToolError(new Forbidden())
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Forbidden")
  })

  it("maps Validation with reason", () => {
    const result = mapToolError(new Validation({ reason: "bad_input" }))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Validation")
  })

  it("maps unknown defects to a generic Internal error", () => {
    const result = mapToolError(new Error("boom"))
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("Internal error")
  })
})

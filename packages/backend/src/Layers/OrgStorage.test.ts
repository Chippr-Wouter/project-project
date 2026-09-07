import { describe, expect, it } from "vite-plus/test"
import { maskAccessKeyId } from "../Services/OrgStorage"

describe("maskAccessKeyId", () => {
  it("keeps the last four characters", () => {
    expect(maskAccessKeyId("AKIAIOSFODNN7EXAMPLE")).toBe("****************MPLE")
  })

  it("masks a short key entirely", () => {
    expect(maskAccessKeyId("abc")).toBe("***")
  })

  it("masks an empty key to an empty string", () => {
    expect(maskAccessKeyId("")).toBe("")
  })

  it("never reveals more than the last four characters", () => {
    const masked = maskAccessKeyId("projectproject")
    expect(masked.endsWith("ject")).toBe(true)
    expect(masked.startsWith("*")).toBe(true)
    expect(masked).toHaveLength("projectproject".length)
  })
})

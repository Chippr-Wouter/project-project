import { describe, expect, it } from "vite-plus/test"
import type { Org } from "@projectproject/shared"
import { nextActiveOrgSlug } from "./orgReflow"

const org = (slug: string): Org => ({ slug, name: slug, role: "owner" })

describe("nextActiveOrgSlug", () => {
  it("returns the first remaining org after removing the deleted one", () => {
    expect(
      nextActiveOrgSlug([org("acme"), org("globex"), org("initech")], "acme")
    ).toBe("globex")
  })

  it("skips the removed org even when it is not first", () => {
    expect(nextActiveOrgSlug([org("acme"), org("globex")], "globex")).toBe(
      "acme"
    )
  })

  it("returns null when no orgs remain", () => {
    expect(nextActiveOrgSlug([org("acme")], "acme")).toBeNull()
  })

  it("returns null for an empty list", () => {
    expect(nextActiveOrgSlug([], "acme")).toBeNull()
  })
})

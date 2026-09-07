import { describe, expect, it } from "vite-plus/test"
import { OUTER_RING } from "./colors"
import {
  PROJECT_STARTER_EMOJIS,
  deriveProjectColor,
  deriveProjectIcon,
  deriveProjectIdentity
} from "./identity"

describe("PROJECT_STARTER_EMOJIS", () => {
  it("has 20 unique entries", () => {
    expect(PROJECT_STARTER_EMOJIS).toHaveLength(20)
    expect(new Set(PROJECT_STARTER_EMOJIS).size).toBe(20)
  })
})

describe("deriveProjectIcon", () => {
  it("is deterministic for the same slug", () => {
    expect(deriveProjectIcon("project-project")).toBe(
      deriveProjectIcon("project-project")
    )
  })

  it("returns a value from the starter palette", () => {
    expect(PROJECT_STARTER_EMOJIS as ReadonlyArray<string>).toContain(
      deriveProjectIcon("anything")
    )
  })
})

describe("deriveProjectColor", () => {
  it("is deterministic for the same slug", () => {
    expect(deriveProjectColor("project-project")).toBe(
      deriveProjectColor("project-project")
    )
  })

  it("returns a value from OUTER_RING", () => {
    const palette = OUTER_RING.map((c) => c.hex)
    expect(palette).toContain(deriveProjectColor("anything"))
  })
})

describe("deriveProjectIdentity", () => {
  it("does not produce a single (icon, color) combo for varying slugs", () => {
    const seen = new Set<string>()
    for (const slug of [
      "alpha",
      "beta",
      "gamma",
      "delta",
      "epsilon",
      "zeta",
      "eta",
      "theta",
      "iota",
      "kappa"
    ]) {
      const id = deriveProjectIdentity(slug)
      seen.add(`${id.icon}|${id.color}`)
    }
    expect(seen.size).toBeGreaterThan(5)
  })
})

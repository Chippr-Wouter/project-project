import { describe, expect, it } from "vite-plus/test"
import { STATE_COLORS } from "./colors"

describe("STATE_COLORS.warning", () => {
  it("keeps the same hue across light and dark", () => {
    expect(STATE_COLORS.warning.light.hue).toBe(STATE_COLORS.warning.dark.hue)
  })

  it("uses a darker, more saturated swatch in light mode for contrast against a white background", () => {
    expect(STATE_COLORS.warning.light.L).toBeLessThan(
      STATE_COLORS.warning.dark.L
    )
    expect(STATE_COLORS.warning.light.C).toBeGreaterThan(
      STATE_COLORS.warning.dark.C
    )
  })

  it("matches the DESIGN.md-documented light/dark values", () => {
    expect(STATE_COLORS.warning.light.oklch).toBe("oklch(0.5 0.16 75)")
    expect(STATE_COLORS.warning.dark.oklch).toBe("oklch(0.78 0.07 75)")
  })
})

describe("STATE_COLORS other tokens", () => {
  it("keep a single swatch shared between light and dark", () => {
    for (const name of ["danger", "success", "info", "merged"] as const) {
      expect(STATE_COLORS[name].light).toEqual(STATE_COLORS[name].dark)
    }
  })
})

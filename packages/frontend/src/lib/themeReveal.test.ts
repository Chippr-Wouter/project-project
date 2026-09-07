import { describe, expect, it } from "vite-plus/test"
import { getThemeRevealRadius } from "@/lib/themeReveal"

describe("getThemeRevealRadius", () => {
  it("reaches the furthest corner from the viewport center", () => {
    expect(getThemeRevealRadius(50, 50, 100, 100)).toBeCloseTo(70.71, 2)
  })

  it("reaches the opposite corner from the viewport edge", () => {
    expect(getThemeRevealRadius(0, 0, 100, 100)).toBeCloseTo(141.42, 2)
  })
})

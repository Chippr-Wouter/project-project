import { Circle, CircleCheck } from "lucide-react"
import { describe, expect, it } from "vite-plus/test"
import { getStatusIcon } from "./status-icons"

describe("getStatusIcon", () => {
  it("resolves CircleCheck to the check icon, not the fallback circle", () => {
    expect(getStatusIcon("CircleCheck")).toBe(CircleCheck)
    expect(getStatusIcon("CircleCheck")).not.toBe(Circle)
  })

  it("falls back to Circle for unknown names", () => {
    expect(getStatusIcon("NotAnIcon")).toBe(Circle)
  })
})

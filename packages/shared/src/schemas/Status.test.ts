import { describe, expect, it } from "vite-plus/test"
import { STATUS_ICONS } from "./Status"

describe("STATUS_ICONS", () => {
  it("includes CircleCheck for done-style statuses", () => {
    expect(STATUS_ICONS).toContain("CircleCheck")
  })

  it("does not include the deprecated CheckCircle2 alias", () => {
    expect(STATUS_ICONS).not.toContain("CheckCircle2")
  })
})

import { describe, expect, it } from "vite-plus/test"
import {
  DEFAULT_WORK_TYPES,
  type OrgEverhourConfig
} from "@projectproject/shared"
import {
  resolveSprintForTicket,
  summariseAttribution,
  timerComment,
  workTypeOptions
} from "./EverhourTimeTracking"

describe("timerComment", () => {
  it("stamps the ticket id and title", () => {
    expect(timerComment("T-12", "Fix the thing")).toBe("T-12 — Fix the thing")
  })

  it("appends the user's note", () => {
    expect(timerComment("T-12", "Fix the thing", "pairing")).toBe(
      "T-12 — Fix the thing — pairing"
    )
  })

  it("falls back to the bare ticket id when there is no title", () => {
    expect(timerComment("T-12", null)).toBe("T-12")
  })

  it("is just the note for ticket-less (sprint) entries", () => {
    expect(timerComment(null, null, "sprint planning")).toBe("sprint planning")
    expect(timerComment(null, null)).toBe("")
  })
})

describe("summariseAttribution", () => {
  const rows = [
    { everhourUserId: "u-1", seconds: 3600 },
    { everhourUserId: "u-2", seconds: 1800 },
    { everhourUserId: "u-1", seconds: 600 }
  ]

  it("totals all seconds and isolates the actor's seconds", () => {
    expect(summariseAttribution(rows, "u-1")).toEqual({
      totalSeconds: 6000,
      userSeconds: 4200
    })
  })

  it("reports zero user seconds when the actor has no Everhour identity", () => {
    expect(summariseAttribution(rows, null)).toEqual({
      totalSeconds: 6000,
      userSeconds: 0
    })
  })
})

describe("resolveSprintForTicket", () => {
  const sprints = [
    { id: "G-1", tickets: ["T-1", "T-2"] },
    { id: "G-2", tickets: ["T-3"] }
  ]

  it("finds the sprint containing the ticket", () => {
    expect(resolveSprintForTicket(sprints, "T-3")).toBe("G-2")
  })

  it("returns null when the ticket is in no sprint", () => {
    expect(resolveSprintForTicket(sprints, "T-99")).toBeNull()
  })
})

describe("workTypeOptions", () => {
  it("projects the org config into ordered {key,label} options", () => {
    const config: OrgEverhourConfig = { workTypes: DEFAULT_WORK_TYPES }
    expect(workTypeOptions(config)).toEqual([
      { key: "development", label: "Development" },
      { key: "design", label: "Design" },
      { key: "project_management", label: "Project Management" },
      { key: "meetings", label: "Meetings & Workshops" },
      { key: "testing", label: "Testing" }
    ])
  })

  it("sorts by order regardless of array order", () => {
    const config: OrgEverhourConfig = {
      workTypes: [
        { key: "b", label: "B", order: 2, isDefault: false },
        { key: "a", label: "A", order: 1, isDefault: true }
      ]
    }
    expect(workTypeOptions(config).map((o) => o.key)).toEqual(["a", "b"])
  })
})

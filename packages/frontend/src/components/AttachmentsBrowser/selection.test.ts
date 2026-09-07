import { describe, expect, it } from "vite-plus/test"
import type { AttachmentStatus } from "@projectproject/shared"
import {
  allDeletableSelected,
  deletableIds,
  hasThumbnail,
  isDeletable,
  prunedSelection,
  toggleSelection
} from "./selection"

interface SelectableRow {
  readonly id: string
  readonly status: AttachmentStatus
}

const rows: ReadonlyArray<SelectableRow> = [
  { id: "live-1", status: "live" as const },
  { id: "orphan-1", status: "orphaned" as const },
  { id: "pending-1", status: "pending" as const },
  { id: "orphan-2", status: "orphaned" as const }
]

describe("isDeletable", () => {
  it("admits an orphaned attachment", () => {
    expect(isDeletable(rows[1])).toBe(true)
  })

  it("admits a live attachment, whose reference is left broken on purpose", () => {
    expect(isDeletable(rows[0])).toBe(true)
  })

  it("refuses a pending attachment, whose upload may still land", () => {
    expect(isDeletable(rows[2])).toBe(false)
  })
})

describe("hasThumbnail", () => {
  it("shows a thumbnail for a live raster image", () => {
    expect(hasThumbnail({ status: "live", contentType: "image/png" })).toBe(
      true
    )
  })

  it("shows a thumbnail for an orphaned image, which still serves", () => {
    expect(hasThumbnail({ status: "orphaned", contentType: "image/png" })).toBe(
      true
    )
  })

  it("falls back for a pending image, whose object may not exist yet", () => {
    expect(hasThumbnail({ status: "pending", contentType: "image/png" })).toBe(
      false
    )
  })

  it("falls back for a live pdf, which has no rendered preview", () => {
    expect(
      hasThumbnail({ status: "live", contentType: "application/pdf" })
    ).toBe(false)
  })
})

describe("deletableIds", () => {
  it("arms everything except the pending upload", () => {
    expect(deletableIds(rows)).toEqual(["live-1", "orphan-1", "orphan-2"])
  })

  it("is empty when only a pending upload is listed", () => {
    expect(deletableIds([rows[2]])).toEqual([])
  })
})

describe("toggleSelection", () => {
  it("adds an id that was not selected", () => {
    expect([...toggleSelection(new Set(), "orphan-1")]).toEqual(["orphan-1"])
  })

  it("removes an id that was selected", () => {
    expect([...toggleSelection(new Set(["orphan-1"]), "orphan-1")]).toEqual([])
  })

  it("leaves the other selected ids alone", () => {
    const next = toggleSelection(new Set(["orphan-1", "orphan-2"]), "orphan-1")
    expect([...next]).toEqual(["orphan-2"])
  })
})

describe("prunedSelection", () => {
  it("drops ids the current rows no longer contain", () => {
    const next = prunedSelection(new Set(["orphan-1", "gone"]), rows)
    expect([...next]).toEqual(["orphan-1"])
  })

  it("drops an id whose row went back to pending", () => {
    const next = prunedSelection(new Set(["pending-1"]), rows)
    expect([...next]).toEqual([])
  })
})

describe("allDeletableSelected", () => {
  it("is true once every deletable row is selected", () => {
    expect(
      allDeletableSelected(new Set(["live-1", "orphan-1", "orphan-2"]), rows)
    ).toBe(true)
  })

  it("is false while a deletable row is unselected", () => {
    expect(allDeletableSelected(new Set(["orphan-1"]), rows)).toBe(false)
  })

  it("is false when there is nothing to select", () => {
    expect(allDeletableSelected(new Set(), [rows[2]])).toBe(false)
  })
})

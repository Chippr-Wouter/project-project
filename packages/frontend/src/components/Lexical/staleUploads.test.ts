import { describe, expect, it } from "vite-plus/test"
import { staleUploadIds } from "./staleUploads"

describe("staleUploadIds", () => {
  it("keeps an upload whose node is still in the document", () => {
    expect(staleUploadIds(["a"], new Set(["a"]))).toEqual([])
  })

  it("reports an upload whose node was removed", () => {
    expect(staleUploadIds(["a"], new Set())).toEqual(["a"])
  })

  it("reports only the removed uploads when several are in flight", () => {
    expect(staleUploadIds(["a", "b", "c"], new Set(["b"]))).toEqual(["a", "c"])
  })

  it("reports every upload once the editor holds no attachment nodes", () => {
    expect(staleUploadIds(["a", "b"], new Set())).toEqual(["a", "b"])
  })

  it("ignores live ids that are not being tracked", () => {
    expect(staleUploadIds([], new Set(["a"]))).toEqual([])
  })

  it("accepts a map's key iterator without materialising it first", () => {
    const inFlight = new Map([
      ["a", 1],
      ["b", 2]
    ])
    expect(staleUploadIds(inFlight.keys(), new Set(["a"]))).toEqual(["b"])
  })
})

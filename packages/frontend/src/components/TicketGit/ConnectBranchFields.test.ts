import { describe, expect, it } from "vite-plus/test"
import { type BranchItemsCache, branchItemsView } from "./ConnectBranchFields"
import type { BranchListItem } from "@projectproject/shared"

const item = (name: string): BranchListItem => ({ name, isProtected: false })

describe("branchItemsView", () => {
  it("keeps previous items while the same repo refetches", () => {
    const cache: BranchItemsCache = {
      repoId: "repo-a",
      items: [item("main")],
      hasLoadedOnce: true
    }

    const view = branchItemsView({
      repoId: "repo-a",
      cache,
      successItems: null,
      loading: true
    })

    expect(view.items).toEqual([item("main")])
    expect(view.showSkeleton).toBe(false)
    expect(view.isRefetching).toBe(true)
  })

  it("drops previous items when the connected repo changes", () => {
    const cache: BranchItemsCache = {
      repoId: "repo-a",
      items: [item("main")],
      hasLoadedOnce: true
    }

    const view = branchItemsView({
      repoId: "repo-b",
      cache,
      successItems: null,
      loading: true
    })

    expect(view.items).toEqual([])
    expect(view.showSkeleton).toBe(true)
    expect(view.isRefetching).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test"
import { cleanup, renderHook } from "@testing-library/react"

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }))

vi.mock("@effect/atom-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@effect/atom-react")>()
  return { ...actual, useAtomRefresh: () => refreshMock }
})

import { useProjectGitStatePolling } from "./useProjectGitStatePolling"

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state
  })
}

describe("useProjectGitStatePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    refreshMock.mockClear()
    setVisibility("visible")
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("polls once per minute while the tab is visible", () => {
    renderHook(() => useProjectGitStatePolling("org", "project", true))

    vi.advanceTimersByTime(20_000)
    expect(refreshMock).not.toHaveBeenCalled()

    vi.advanceTimersByTime(40_000)
    expect(refreshMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(60_000)
    expect(refreshMock).toHaveBeenCalledTimes(2)
  })

  it("does not poll while the tab is hidden", () => {
    setVisibility("hidden")
    renderHook(() => useProjectGitStatePolling("org", "project", true))

    vi.advanceTimersByTime(60_000)
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("refreshes when the window regains focus", () => {
    renderHook(() => useProjectGitStatePolling("org", "project", true))

    window.dispatchEvent(new Event("focus"))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it("refreshes when the tab becomes visible again", () => {
    renderHook(() => useProjectGitStatePolling("org", "project", true))

    document.dispatchEvent(new Event("visibilitychange"))
    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it("ignores focus events while the tab is hidden", () => {
    setVisibility("hidden")
    renderHook(() => useProjectGitStatePolling("org", "project", true))

    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("does nothing when disabled", () => {
    renderHook(() => useProjectGitStatePolling("org", "project", false))

    vi.advanceTimersByTime(60_000)
    window.dispatchEvent(new Event("focus"))
    expect(refreshMock).not.toHaveBeenCalled()
  })

  it("stops polling and listening after unmount", () => {
    const { unmount } = renderHook(() =>
      useProjectGitStatePolling("org", "project", true)
    )

    unmount()

    vi.advanceTimersByTime(120_000)
    window.dispatchEvent(new Event("focus"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(refreshMock).not.toHaveBeenCalled()
  })
})

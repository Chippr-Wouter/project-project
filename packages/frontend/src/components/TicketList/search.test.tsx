import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTicketSearch } from "./search"

const initialProps: { query: string | undefined } = { query: "ticket" }

describe("ticket search draft", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("keeps short drafts when its committed query clears", () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(
      ({ query }: { query: string | undefined }) =>
        useTicketSearch(query, commit),
      { initialProps }
    )
    act(() => result.current.change("ti"))
    expect(commit).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(commit).toHaveBeenCalledExactlyOnceWith(undefined)
    rerender({ query: undefined })
    expect(result.current.draft).toBe("ti")
    act(() => result.current.change("t"))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.draft).toBe("t")
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it("restores navigation's query and ignores a queued search from the old location", () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(
      ({ query }: { query: string | undefined }) =>
        useTicketSearch(query, commit),
      { initialProps }
    )
    act(() => result.current.change("pending draft"))
    rerender({ query: "previous search" })
    expect(result.current.draft).toBe("previous search")
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(commit).not.toHaveBeenCalled()
  })

  it("commits the latest draft once on blur", () => {
    const commit = vi.fn()
    const { result } = renderHook(() => useTicketSearch(undefined, commit))
    act(() => result.current.change("first"))
    act(() => result.current.change("latest"))
    act(() => result.current.flush())
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(commit).toHaveBeenCalledExactlyOnceWith("latest")
  })

  it("clears immediately and cancels pending typing", () => {
    const commit = vi.fn()
    const { result, rerender } = renderHook(
      ({ query }: { query: string | undefined }) =>
        useTicketSearch(query, commit),
      { initialProps }
    )
    act(() => result.current.change("queued"))
    act(() => result.current.clear())
    rerender({ query: undefined })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.draft).toBe("")
    expect(commit).toHaveBeenCalledExactlyOnceWith(undefined)
  })
})

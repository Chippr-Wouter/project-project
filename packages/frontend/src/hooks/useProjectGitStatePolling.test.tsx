import { RegistryContext } from "@effect/atom-react"
import { cleanup, renderHook, waitFor, act } from "@testing-library/react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import { afterEach, expect, it, vi } from "vitest"
import { projectGitStatesBaseAtom } from "@/atoms/github"
import { useProjectGitStatePolling } from "./useProjectGitStatePolling"

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("coalesces focus and visibility events, skips in-flight reads, and stops while hidden or unmounted", async () => {
  const registry = Registry.make()
  const signals: Array<AbortSignal | null | undefined> = []
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      "http://localhost"
    ).pathname
    if (!path.endsWith("/git-states")) return new Promise<Response>(() => {})
    signals.push(
      init?.signal ?? (input instanceof Request ? input.signal : null)
    )
    if (signals.length === 1)
      return Promise.resolve(
        Response.json({
          states: {},
          transitioned: [],
          tokenStatus: "ok",
          repoStatus: "ok"
        })
      )
    return new Promise<Response>(() => {})
  })
  vi.stubGlobal("fetch", fetch)
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("visible")
  const atom = projectGitStatesBaseAtom("org/project")
  registry.mount(atom)
  try {
    await waitFor(() =>
      expect(registry.get(atom)).toMatchObject({
        _tag: "Success",
        waiting: false
      })
    )
    vi.useFakeTimers()
    const { unmount } = renderHook(
      () => useProjectGitStatePolling("org", "project", true),
      {
        wrapper: ({ children }) => (
          <RegistryContext.Provider value={registry}>
            {children}
          </RegistryContext.Provider>
        )
      }
    )
    visibility.mockReturnValue("hidden")
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_050)
    })
    expect(signals).toHaveLength(1)
    visibility.mockReturnValue("visible")
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(signals).toHaveLength(2)
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(signals).toHaveLength(2)
    expect(signals[1]?.aborted).toBe(false)
    visibility.mockReturnValue("hidden")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(signals).toHaveLength(2)
    unmount()
    visibility.mockReturnValue("visible")
    await act(async () => {
      window.dispatchEvent(new Event("focus"))
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(signals).toHaveLength(2)
  } finally {
    cleanup()
    registry.dispose()
  }
})

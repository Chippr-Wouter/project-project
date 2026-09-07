import { describe, expect, it, vi } from "vite-plus/test"
import {
  formatClock,
  startSecondInterval,
  timerEntryMotion
} from "./RunningTimerIndicator"

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [65, "1:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3661, "1:01:01"]
  ])("formats %i seconds as %s", (seconds, expected) => {
    expect(formatClock(seconds)).toBe(expected)
  })
})

describe("timerEntryMotion", () => {
  it("removes entry movement for reduced motion", () => {
    expect(timerEntryMotion(true)).toEqual({
      initial: false,
      animate: { opacity: 1 }
    })
  })
})

describe("startSecondInterval", () => {
  it("runs immediately and clears its interval", () => {
    const update = vi.fn()
    const clearInterval = vi.spyOn(window, "clearInterval")
    const cleanup = startSecondInterval(update)
    expect(update).toHaveBeenCalledOnce()
    cleanup()
    expect(clearInterval).toHaveBeenCalledOnce()
    clearInterval.mockRestore()
  })
})

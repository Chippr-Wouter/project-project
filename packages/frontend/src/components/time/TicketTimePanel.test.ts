import { describe, expect, it } from "vite-plus/test"
import { formatDuration } from "./TicketTimePanel"

describe("formatDuration", () => {
  it.each([
    [0, "0m"],
    [60, "1m"],
    [3600, "1h"],
    [5460, "1h 31m"]
  ])("formats %i seconds as compact localized time", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})

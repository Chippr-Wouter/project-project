import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as Schema from "effect/Schema"
import { createElement } from "react"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { TicketId } from "@projectproject/shared"
import { LogTimeForm, parseDurationToSeconds } from "./LogTimeForm"

const mocks = vi.hoisted(() => ({ logTime: vi.fn() }))

vi.mock("@effect-atom/atom-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@effect-atom/atom-react")>()
  return {
    ...actual,
    useAtomSet: () => mocks.logTime,
    useAtomValue: () => actual.Result.initial()
  }
})

vi.mock("@/components/time/WorkTypeSelect", () => ({
  WorkTypeSelect: () => null
}))

afterEach(() => {
  cleanup()
  mocks.logTime.mockReset()
})

describe("parseDurationToSeconds", () => {
  it.each([
    ["90", 5400],
    ["1h 30m", 5400],
    ["1.5h", 5400],
    ["45m", 2700]
  ])("parses %s", (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected)
  })

  it.each(["", "0", "later"])("rejects %s", (input) => {
    expect(parseDurationToSeconds(input)).toBeNull()
  })
})

describe("LogTimeForm", () => {
  const ticketId = Schema.decodeUnknownSync(TicketId)("T-1")
  const props = {
    orgSlug: "acme",
    slug: "project",
    ticketId,
    options: [{ key: "development", label: "Development" }],
    defaultWorkType: "development"
  }

  it("autofocuses duration and announces invalid input", () => {
    render(createElement(LogTimeForm, props))
    expect(screen.getByLabelText("Duration")).toBe(document.activeElement)
    fireEvent.click(screen.getByRole("button", { name: "Log time" }))
    expect(screen.getByRole("alert").textContent).toBe(
      "Enter a duration like 1h 30m."
    )
  })

  it("submits parsed time and closes after success", async () => {
    const onDone = vi.fn()
    mocks.logTime.mockResolvedValue({ _tag: "Success" })
    render(createElement(LogTimeForm, { ...props, onDone }))
    fireEvent.change(screen.getByLabelText("Duration"), {
      target: { value: "1h 30m" }
    })
    fireEvent.click(screen.getByRole("button", { name: "Log time" }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    expect(mocks.logTime).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: "T-1",
        workTypeKey: "development",
        seconds: 5400
      })
    )
  })
})

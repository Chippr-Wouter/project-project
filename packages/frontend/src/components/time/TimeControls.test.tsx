import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vite-plus/test"
import { disclosureMotion, TimeControls } from "./TimeControls"

afterEach(cleanup)

vi.mock("@/components/time/WorkTypeSelect", () => ({
  WorkTypeSelect: ({ value }: { value: string }) => <span>{value}</span>
}))

const renderControls = (
  overrides: Partial<ComponentProps<typeof TimeControls>> = {}
) => {
  const props: ComponentProps<typeof TimeControls> = {
    value: "development",
    onValueChange: vi.fn(),
    options: [{ key: "development", label: "Development" }],
    running: false,
    busy: false,
    onStart: vi.fn(),
    onStop: vi.fn(),
    logOpen: false,
    onLogOpenChange: vi.fn(),
    children: <div>Manual fields</div>,
    ...overrides
  }
  return { props, ...render(<TimeControls {...props} />) }
}

describe("TimeControls", () => {
  it("starts the selected work type", () => {
    const { props } = renderControls()
    fireEvent.click(screen.getByRole("button", { name: "Start timer" }))
    expect(props.onStart).toHaveBeenCalledOnce()
  })

  it("shows a stop action while running", () => {
    const { props } = renderControls({ running: true })
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }))
    expect(props.onStop).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: "Start timer" })).toBeNull()
  })

  it("exposes and toggles manual log disclosure state", () => {
    const onLogOpenChange = vi.fn()
    renderControls({ onLogOpenChange })
    const trigger = screen.getByRole("button", { name: "Log time" })
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(trigger)
    expect(onLogOpenChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText("Manual fields")).toBeNull()
  })

  it("renders disclosed fields and requests close", () => {
    const onLogOpenChange = vi.fn()
    renderControls({ logOpen: true, onLogOpenChange })
    expect(screen.getByText("Manual fields")).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Log time" }))
    expect(onLogOpenChange).toHaveBeenCalledWith(false)
  })

  it("removes disclosure movement for reduced motion", () => {
    expect(disclosureMotion(true)).toEqual({
      initial: false,
      animate: { opacity: 1 },
      exit: { opacity: 0 }
    })
  })
})

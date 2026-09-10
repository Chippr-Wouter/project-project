import { cleanup, render } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { VirtualSprintCards } from "./VirtualSprintCards"

const { monitor, release } = vi.hoisted(() => ({
  monitor: vi.fn(),
  release: vi.fn()
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  monitorForElements: monitor.mockImplementation(() => release)
}))
vi.mock("./useSprintEdgeScroll", () => ({ useSprintEdgeScroll: vi.fn() }))
vi.mock("@tanstack/react-virtual", () => ({
  defaultRangeExtractor: vi.fn(),
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0
  })
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it("keeps the drag monitor subscribed when an empty column gets a new ticket array", () => {
  const { rerender, unmount } = render(
    <VirtualSprintCards tickets={[]} status="todo" isDraggable>
      {() => null}
    </VirtualSprintCards>
  )
  expect(monitor).toHaveBeenCalledTimes(1)

  rerender(
    <VirtualSprintCards tickets={[]} status="todo" isDraggable>
      {() => null}
    </VirtualSprintCards>
  )
  expect(monitor).toHaveBeenCalledTimes(1)
  expect(release).not.toHaveBeenCalled()

  unmount()
  expect(release).toHaveBeenCalledTimes(1)
})

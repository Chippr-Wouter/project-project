import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ticketListQueryFromSearch } from "@projectproject/shared"
import { ToolbarProvider, useToolbar } from "./context"
import { ClearAll, Root, Search } from "./parts"

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigation.navigate,
  useRouter: () => ({ state: { location: { pathname: "/tickets" } } })
}))

const observeQuery = vi.fn()
function QueryObserver() {
  const { query } = useToolbar()
  observeQuery(query)
  return null
}

function Toolbar() {
  const [query, setQuery] = useState(
    ticketListQueryFromSearch({ type: ["bug"] })
  )
  navigation.navigate.mockImplementation(({ search }) => {
    setQuery(ticketListQueryFromSearch(search({})))
    return Promise.resolve()
  })
  return (
    <ToolbarProvider
      orgSlug="org"
      slug="project"
      query={query}
      members={[]}
      counts={{ all: 0 }}
      filters={["type"]}
    >
      <Root>
        <Search />
        <ClearAll />
        <QueryObserver />
      </Root>
    </ToolbarProvider>
  )
}

describe("toolbar search ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      }
    )
    observeQuery.mockClear()
    navigation.navigate.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("keeps draft typing local until the debounced query commits", () => {
    render(<Toolbar />)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "first" } })
    const renders = observeQuery.mock.calls.length
    fireEvent.change(input, { target: { value: "latest" } })
    expect(observeQuery).toHaveBeenCalledTimes(renders)
    expect(navigation.navigate).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(observeQuery.mock.lastCall?.[0].q).toBe("latest")
    expect(observeQuery.mock.lastCall?.[0].filter.type).toEqual(["bug"])
  })

  it("clears an uncommitted draft and cancels its pending navigation", () => {
    render(<Toolbar />)
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "pending" }
    })
    fireEvent.click(screen.getByTitle("Clear all filters"))
    expect(screen.getByRole("textbox")).toHaveProperty("value", "")
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(navigation.navigate).toHaveBeenCalledTimes(1)
    expect(observeQuery.mock.lastCall?.[0].q).toBeUndefined()
    expect(observeQuery.mock.lastCall?.[0].filter).toBeUndefined()
  })
})

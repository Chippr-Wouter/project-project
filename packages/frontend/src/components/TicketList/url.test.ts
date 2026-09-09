import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ticketListQueryFromSearch } from "@projectproject/shared"
import { useUpdateTicketQuery } from "./url"

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }))
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigation.navigate,
  useRouter: () => ({ state: { location: { pathname: "/tickets" } } })
}))

describe("ticket query navigation", () => {
  it("replaces ticket search fields and resets pagination while preserving the view", () => {
    const { result } = renderHook(() => useUpdateTicketQuery())
    result.current(ticketListQueryFromSearch({ q: "latest", type: ["bug"] }))
    const options = navigation.navigate.mock.lastCall?.[0]
    expect(options).toMatchObject({
      to: "/tickets",
      replace: true,
      resetScroll: false
    })
    expect(
      options.search({
        view: "list",
        q: "old",
        status: ["done"],
        cursor: "next"
      })
    ).toMatchObject({
      view: "list",
      q: "latest",
      type: ["bug"],
      status: undefined,
      cursor: undefined
    })
  })
})

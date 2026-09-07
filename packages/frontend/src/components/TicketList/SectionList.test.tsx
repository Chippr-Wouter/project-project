import { renderHook } from "@testing-library/react"
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { TicketId } from "@projectproject/shared"
import { useStableTicketKeys } from "./SectionList"

const ticketId = Schema.decodeUnknownSync(TicketId)

describe("useStableTicketKeys", () => {
  it("gives a reused optimistic ticket ID a new row key", () => {
    const existing = { id: ticketId("T-1") }
    const optimistic = { id: ticketId("T-999999") }
    const firstCreated = { id: ticketId("T-2") }
    const secondCreated = { id: ticketId("T-3") }

    const { result, rerender } = renderHook(
      ({ items, waiting }) => useStableTicketKeys(items, waiting),
      { initialProps: { items: [existing], waiting: false } }
    )

    rerender({ items: [optimistic, existing], waiting: true })
    const firstOptimisticKey = result.current[0].key

    rerender({ items: [firstCreated, existing], waiting: false })
    expect(result.current[0].key).toBe(firstOptimisticKey)

    rerender({
      items: [optimistic, firstCreated, existing],
      waiting: true
    })

    expect(new Set(result.current.map(({ key }) => key)).size).toBe(3)
    expect(result.current[0].key).not.toBe(firstOptimisticKey)
    expect(result.current[0].pending).toBe(true)
    expect(result.current[1].pending).toBe(false)

    rerender({
      items: [secondCreated, firstCreated, existing],
      waiting: false
    })

    expect(result.current[0].pending).toBe(false)
  })
})

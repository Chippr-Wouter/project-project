import * as Schema from "effect/Schema"
import { describe, expect, it } from "vite-plus/test"
import { TicketId } from "./Ticket"

const decodeTicketId = Schema.decodeUnknownExit(TicketId)

describe("TicketId", () => {
  it("accepts legacy T-prefixed ids", () => {
    expect(decodeTicketId("T-35")._tag).toBe("Success")
  })

  it("accepts project-key-prefixed ids across key lengths", () => {
    expect(decodeTicketId("FOO-1")._tag).toBe("Success")
    expect(decodeTicketId("A1B2-42")._tag).toBe("Success")
    expect(decodeTicketId("ABCDEFGHIJ-999")._tag).toBe("Success")
  })

  it("rejects malformed ids", () => {
    for (const value of ["FOO-0", "foo-1", "1FOO-1", "A-1", "FOO-BAR"]) {
      expect(decodeTicketId(value)._tag).toBe("Failure")
    }
  })
})

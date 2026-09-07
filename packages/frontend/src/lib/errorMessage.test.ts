import { describe, expect, it } from "vite-plus/test"
import { Conflict, Forbidden, NotFound } from "@projectproject/shared"
import { statusCreateErrorMessage } from "./errorMessage"

describe("statusCreateErrorMessage", () => {
  it("maps a reserved-slug conflict to the reserved-name message", () => {
    expect(
      statusCreateErrorMessage(new Conflict({ reason: "reserved_slug" }))
    ).toBe("That name is reserved by a built-in status.")
  })

  it("maps a duplicate-slug conflict to the already-exists message", () => {
    expect(
      statusCreateErrorMessage(new Conflict({ reason: "slug_exists" }))
    ).toBe("A status with this name already exists.")
  })

  it("maps an invalid-label conflict to the invalid-name message", () => {
    expect(
      statusCreateErrorMessage(new Conflict({ reason: "invalid_label" }))
    ).toBe("Pick a name with at least one letter or digit.")
  })

  it("falls back for an unknown conflict reason", () => {
    expect(statusCreateErrorMessage(new Conflict({ reason: "whatever" }))).toBe(
      "Couldn't add this status. Try again."
    )
  })

  it("falls back for non-conflict errors", () => {
    expect(statusCreateErrorMessage(new Forbidden())).toBe(
      "Couldn't add this status. Try again."
    )
    expect(statusCreateErrorMessage(new NotFound())).toBe(
      "Couldn't add this status. Try again."
    )
  })
})

import { describe, expect, it } from "vite-plus/test"
import {
  Conflict,
  Forbidden,
  NotFound,
  Unauthorized,
  Validation
} from "@projectproject/shared"
import {
  figmaStatusErrorMessage,
  oauthConsentErrorMessage,
  statusCreateErrorMessage
} from "./errorMessage"

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

describe("figmaStatusErrorMessage", () => {
  it("maps persisted status keys through the localized error mapper", () => {
    expect(figmaStatusErrorMessage("figma_file_not_found")).toBe(
      "That Figma file no longer exists, or this connection cannot see it."
    )
    expect(figmaStatusErrorMessage("figma_unavailable")).toBe(
      "Figma could not be reached. Try again in a moment."
    )
  })
})

describe("oauthConsentErrorMessage", () => {
  it("explains how to recover from an invalid or expired consent link", () => {
    expect(
      oauthConsentErrorMessage(new Validation({ reason: "invalid_signature" }))
    ).toBe(
      "This authorization link has expired or is invalid. Start a new connection from your agent and try again."
    )
  })
  it("asks the user to sign in when their session has expired", () => {
    expect(oauthConsentErrorMessage(new Unauthorized())).toBe(
      "Your session has expired. Sign in again, then start a new connection from your agent."
    )
  })
  it("gives recovery instructions without exposing unexpected errors", () => {
    expect(oauthConsentErrorMessage(new Error("private failure"))).toBe(
      "Couldn’t complete authorization. Try again. If it keeps failing, start a new connection from your agent."
    )
  })
})

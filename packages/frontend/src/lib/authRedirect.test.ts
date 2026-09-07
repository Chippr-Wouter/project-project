import { describe, expect, test } from "vite-plus/test"
import { authedRouteRedirect } from "./authRedirect"

describe("authedRouteRedirect", () => {
  test("sends no-org users at root to welcome", () => {
    expect(authedRouteRedirect("/", null)).toEqual({ to: "/welcome" })
  })

  test("sends no-org users at profile to welcome", () => {
    expect(authedRouteRedirect("/profile", null)).toEqual({ to: "/welcome" })
  })

  test("sends no-org users at org routes to welcome", () => {
    expect(authedRouteRedirect("/orgs/demo", null)).toEqual({
      to: "/welcome"
    })
  })

  test("sends signed-in users with an active org to that org dashboard", () => {
    expect(authedRouteRedirect("/", "demo")).toEqual({
      to: "/orgs/$orgSlug",
      params: { orgSlug: "demo" }
    })
  })

  test("does not redirect active-org users at profile", () => {
    expect(authedRouteRedirect("/profile", "demo")).toBeNull()
  })

  test("does not redirect active-org users at org routes", () => {
    expect(authedRouteRedirect("/orgs/demo", "demo")).toBeNull()
  })
})

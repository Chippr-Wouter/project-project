import { describe, expect, it, beforeEach } from "vite-plus/test"
import { renderHook, act } from "@testing-library/react"
import * as Schema from "effect/Schema"
import { useLocalStorageState } from "./useLocalStorageState"

const StringSet = Schema.Array(Schema.String)

describe("useLocalStorageState", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it("returns the initial value when no entry exists", () => {
    const { result } = renderHook(() =>
      useLocalStorageState("test:empty", StringSet, ["a"])
    )
    expect(result.current[0]).toEqual(["a"])
  })

  it("returns the decoded value when a valid entry exists", () => {
    window.localStorage.setItem("test:exists", JSON.stringify(["x", "y"]))
    const { result } = renderHook(() =>
      useLocalStorageState("test:exists", StringSet, [])
    )
    expect(result.current[0]).toEqual(["x", "y"])
  })

  it("falls back to initial when the stored entry is malformed", () => {
    window.localStorage.setItem("test:bad", "not-json")
    const { result } = renderHook(() =>
      useLocalStorageState("test:bad", StringSet, ["fallback"])
    )
    expect(result.current[0]).toEqual(["fallback"])
  })

  it("falls back to initial when the stored entry fails schema decode", () => {
    window.localStorage.setItem("test:wrong", JSON.stringify({ not: "array" }))
    const { result } = renderHook(() =>
      useLocalStorageState("test:wrong", StringSet, ["fallback"])
    )
    expect(result.current[0]).toEqual(["fallback"])
  })

  it("persists updates to localStorage", () => {
    const { result } = renderHook(() =>
      useLocalStorageState("test:write", StringSet, [])
    )
    act(() => result.current[1](["new", "value"]))
    expect(JSON.parse(window.localStorage.getItem("test:write")!)).toEqual([
      "new",
      "value"
    ])
    expect(result.current[0]).toEqual(["new", "value"])
  })
})

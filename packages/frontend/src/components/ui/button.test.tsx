import { render } from "@testing-library/react"
import { describe, expect, it } from "vite-plus/test"
import { Button, type ButtonProps } from "./button"

describe("Button", () => {
  it("keeps sidebar links flush with their container", () => {
    const { getByRole } = render(
      <Button variant="sidebar-link" size="sm">
        Design
      </Button>
    )

    const button = getByRole("button", { name: "Design" })

    expect(button.classList.contains("px-0")).toBe(true)
    expect(button.classList.contains("px-3")).toBe(false)
  })

  it.each([
    ["xs", "size-3"],
    ["sm", "size-4"],
    ["md", "size-5"],
    ["lg", "size-6"],
    ["icon-xs", "size-3"],
    ["icon-sm", "size-4"],
    ["icon", "size-5"],
    ["icon-lg", "size-6"]
  ] satisfies Array<[NonNullable<ButtonProps["size"]>, string]>)(
    "sizes the loading spinner for %s buttons",
    (size, className) => {
      const { container } = render(
        <Button size={size} loading>
          Save
        </Button>
      )

      const spinner = container.querySelector("svg")

      expect(spinner).not.toBeNull()
      expect(spinner?.classList.contains(className)).toBe(true)
      expect(spinner?.classList.contains("h-8")).toBe(false)
      expect(spinner?.classList.contains("w-8")).toBe(false)
    }
  )
})

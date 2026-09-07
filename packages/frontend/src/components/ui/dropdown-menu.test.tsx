import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react"
import { afterEach, describe, expect, it } from "vite-plus/test"
import { useState } from "react"
import {
  DeferredDropdownMenus,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "./dropdown-menu"

function Menu({ controlled = false }: { controlled?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <DeferredDropdownMenus>
      <DropdownMenu open={controlled ? open : undefined} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={<button>Actions</button>} />
        <DropdownMenuContent>
          <DropdownMenuItem>Choose</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </DeferredDropdownMenus>
  )
}

afterEach(cleanup)

describe("deferred dropdown menus", () => {
  it.each([false, true])(
    "opens on the first click with controlled=%s",
    async (controlled) => {
      render(<Menu controlled={controlled} />)
      const trigger = screen.getByRole("button", { name: "Actions" })
      fireEvent.click(trigger)
      const item = await screen.findByRole("menuitem", { name: "Choose" })
      expect(screen.getByRole("button", { name: "Actions" })).toBe(trigger)
      fireEvent.click(item)
      await waitFor(() =>
        expect(trigger.getAttribute("aria-expanded")).toBe("false")
      )
      fireEvent.click(trigger)
      await screen.findByRole("menuitem", { name: "Choose" })
    }
  )

  it("preserves the focused trigger and opens with ArrowDown", async () => {
    render(<Menu />)
    const trigger = screen.getByRole("button", { name: "Actions" })
    act(() => trigger.focus())
    expect(screen.getByRole("button", { name: "Actions" })).toBe(trigger)
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    const item = await screen.findByRole("menuitem", { name: "Choose" })
    fireEvent.keyUp(trigger, { key: "ArrowDown" })
    await waitFor(() => expect(document.activeElement).toBe(item))
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
  })
})

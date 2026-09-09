import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createRef, useState } from "react"
import { afterEach, expect, it, vi } from "vitest"
import { AutosizeTextarea } from "./autosize-textarea"

afterEach(cleanup)

it("supports controlled multiline editing and forwards native input behavior", () => {
  const ref = createRef<HTMLTextAreaElement>()
  const onKeyDown = vi.fn()
  const onBlur = vi.fn()

  function Editor({ disabled = false }: { disabled?: boolean }) {
    const [value, setValue] = useState("First line")
    return (
      <AutosizeTextarea
        ref={ref}
        aria-label="Title"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        maxLength={200}
        disabled={disabled}
      />
    )
  }

  const { rerender } = render(<Editor />)
  const input = screen.getByRole("textbox", { name: "Title" })
  expect(ref.current).toBe(input)
  expect(input).toHaveProperty("maxLength", 200)

  fireEvent.change(input, { target: { value: "First line\nSecond line\n" } })
  expect(input).toHaveProperty("value", "First line\nSecond line\n")
  fireEvent.keyDown(input, { key: "Escape" })
  expect(onKeyDown).toHaveBeenCalledOnce()
  fireEvent.blur(input)
  expect(onBlur).toHaveBeenCalledOnce()

  rerender(<Editor disabled />)
  expect(input).toHaveProperty("disabled", true)
})

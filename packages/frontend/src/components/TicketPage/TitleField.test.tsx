import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import { TicketDetail } from "@projectproject/shared"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { TitleField } from "./TitleField"

const mutation = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock("@effect/atom-react", () => ({
  useAtomSet: () => mutation.update,
  useAtomValue: () => ({ _tag: "Initial", waiting: false })
}))
vi.mock("@/atoms/tickets", () => ({
  ticketKey: () => "ticket",
  updateTicketAtom: () => "update"
}))

const ticket = Schema.decodeSync(TicketDetail)({
  id: "T-1",
  title: "Original title",
  status: "todo",
  type: "chore",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  gitState: { tag: "no_branch", baseBranch: "main" },
  assignees: [],
  archivedAt: null,
  createdBy: "user",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  body: ""
})

beforeEach(() => mutation.update.mockReset())
afterEach(cleanup)

it("starts each edit from the current title and discards cancelled drafts", () => {
  const { rerender } = render(
    <TitleField orgSlug="org" slug="project" ticket={ticket} />
  )
  fireEvent.click(screen.getByRole("button"))
  const input = screen.getByRole("textbox")
  expect(document.activeElement).toBe(input)
  fireEvent.change(input, { target: { value: "Discard this" } })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(mutation.update).not.toHaveBeenCalled()
  rerender(
    <TitleField
      orgSlug="org"
      slug="project"
      ticket={{ ...ticket, title: "Updated elsewhere" }}
    />
  )
  fireEvent.click(screen.getByRole("button"))
  expect(screen.getByRole("textbox")).toHaveProperty(
    "value",
    "Updated elsewhere"
  )
})

it("submits once when Enter is followed by blur while saving", async () => {
  let resolve: (exit: Exit.Exit<void>) => void = () => {}
  const pending = new Promise<Exit.Exit<void>>((done) => {
    resolve = done
  })
  mutation.update.mockReturnValue(pending)
  render(<TitleField orgSlug="org" slug="project" ticket={ticket} />)
  fireEvent.click(screen.getByRole("button"))
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "  New title  " } })
  fireEvent.keyDown(input, { key: "Enter", isComposing: true })
  expect(mutation.update).not.toHaveBeenCalled()
  expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true)
  expect(mutation.update).not.toHaveBeenCalled()
  fireEvent.change(input, { target: { value: "  New title\nSecond line  " } })
  fireEvent.keyDown(input, { key: "Enter" })
  fireEvent.blur(input)
  expect(mutation.update).toHaveBeenCalledExactlyOnceWith({
    title: "New title\nSecond line"
  })
  await act(async () => resolve(Exit.void))
  expect(screen.queryByRole("textbox")).toBeNull()
})

it("keeps the draft available to retry after a failed save", async () => {
  mutation.update
    .mockResolvedValueOnce(Exit.fail("failed"))
    .mockResolvedValueOnce(Exit.void)
  render(<TitleField orgSlug="org" slug="project" ticket={ticket} />)
  fireEvent.click(screen.getByRole("button"))
  const input = screen.getByRole("textbox")
  fireEvent.change(input, { target: { value: "Retry this" } })
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }))
  expect(screen.getByRole("textbox")).toHaveProperty("value", "Retry this")
  await act(async () => fireEvent.keyDown(input, { key: "Enter" }))
  expect(mutation.update).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole("textbox")).toBeNull()
})

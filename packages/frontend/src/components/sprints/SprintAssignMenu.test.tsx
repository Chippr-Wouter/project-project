import { cleanup, render, screen } from "@testing-library/react"
import { Group } from "@projectproject/shared"
import * as Schema from "effect/Schema"
import { afterEach, expect, it, vi } from "vitest"
import { SprintAssignMenu } from "./SprintAssignMenu"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it("defers date formatting until the sprint menu opens", async () => {
  const sprint = Schema.decodeUnknownSync(Group)({
    id: "G-1",
    name: "Upcoming sprint",
    kind: "sprint",
    tickets: [],
    color: "#123456",
    startsAt: "2030-01-01T00:00:00.000Z",
    endsAt: "2030-01-14T00:00:00.000Z",
    completedAt: null,
    createdBy: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  })
  const DateTimeFormat = Intl.DateTimeFormat
  const format = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    ...args: ConstructorParameters<typeof Intl.DateTimeFormat>
  ) {
    return new DateTimeFormat(...args)
  })
  const props = {
    trigger: <button>Choose sprint</button>,
    sprints: [sprint],
    selectedId: null,
    onSelect: vi.fn()
  }
  const { rerender } = render(<SprintAssignMenu {...props} open={false} />)

  expect(format).not.toHaveBeenCalled()

  rerender(<SprintAssignMenu {...props} open />)
  expect(await screen.findByText(sprint.name)).toBeTruthy()
  expect(format).toHaveBeenCalled()
})

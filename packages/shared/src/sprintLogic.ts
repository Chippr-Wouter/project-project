import * as DateTime from "effect/DateTime"
import * as Schema from "effect/Schema"
import type { Group } from "./schemas/Group"

const nowDate = (): Date => DateTime.toDate(DateTime.nowUnsafe())

export const SprintState = Schema.Literals(["active", "planned", "completed"])
export type SprintState = typeof SprintState.Type

export function sprintState(sprint: Group, now: Date = nowDate()): SprintState {
  if (sprint.completedAt !== null) return "completed"
  if (sprint.startsAt !== null && sprint.startsAt > now) return "planned"
  return "active"
}

const compareCreatedAt = (a: Group, b: Group) =>
  a.createdAt.getTime() - b.createdAt.getTime()

const compareStartsThenCreated = (a: Group, b: Group) => {
  const ta = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY
  const tb = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY
  if (ta !== tb) return ta - tb
  return compareCreatedAt(a, b)
}

const onlySprints = (groups: ReadonlyArray<Group>): ReadonlyArray<Group> =>
  groups.filter((g) => g.kind === "sprint")

export function pickActiveSprint(
  groups: ReadonlyArray<Group>,
  now: Date = nowDate()
): Group | null {
  const active = onlySprints(groups).filter(
    (g) => sprintState(g, now) === "active"
  )
  if (active.length === 0) return null
  return [...active].sort(compareStartsThenCreated)[0]
}

export function pickEarliestPlannedSprint(
  groups: ReadonlyArray<Group>,
  now: Date = nowDate()
): Group | null {
  const planned = onlySprints(groups).filter(
    (g) => sprintState(g, now) === "planned"
  )
  if (planned.length === 0) return null
  return [...planned].sort(compareStartsThenCreated)[0]
}

export function activeAndPlannedCount(
  groups: ReadonlyArray<Group>,
  now: Date = nowDate()
): number {
  return onlySprints(groups).filter((g) => sprintState(g, now) !== "completed")
    .length
}

export function daysLeft(
  endsAt: Date | null,
  now: Date = nowDate()
): number | null {
  if (endsAt === null) return null
  const ms = endsAt.getTime() - now.getTime()
  return Math.ceil(ms / (1000 * 60 * 60 * 24))
}

import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import {
  GroupId,
  TicketId,
  type ActiveTimer,
  type LogTimeInput,
  type StartSprintTimerInput,
  type StartTimerInput
} from "@projectproject/shared"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"

const makeTicketId = Schema.decodeUnknownSync(TicketId)
const makeGroupId = Schema.decodeUnknownSync(GroupId)

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const sep = key.indexOf("/")
  return { orgSlug: key.slice(0, sep), slug: key.slice(sep + 1) }
}

const splitTicketKey = (
  key: string
): { orgSlug: string; slug: string; id: TicketId } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    id: makeTicketId(parts.slice(2).join("/"))
  }
}

const splitGroupKey = (
  key: string
): { orgSlug: string; slug: string; id: GroupId } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    id: makeGroupId(parts.slice(2).join("/"))
  }
}

export const ticketKey = (orgSlug: string, slug: string, id: TicketId) =>
  `${orgSlug}/${slug}/${id}`

export const ticketTimeKeysForTimers = (
  orgSlug: string,
  timers: ReadonlyArray<ActiveTimer | null>
): ReadonlyArray<string> =>
  Array.from(
    new Set(
      timers.flatMap((timer) =>
        timer?.ticketId ? [ticketKey(orgSlug, timer.slug, timer.ticketId)] : []
      )
    )
  )

export const optimisticStopTimer = <E>(
  current: Result.AsyncResult<ActiveTimer | null, E>
): Result.AsyncResult<ActiveTimer | null, E> =>
  Result.isSuccess(current)
    ? Result.success(current.value, { waiting: true })
    : current

export const groupKey = (orgSlug: string, slug: string, id: GroupId) =>
  `${orgSlug}/${slug}/${id}`

export const activeTimerBaseAtom = Atom.family((orgSlug: string) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.everhour.currentTimer({ params: { orgSlug } })
      })
    )
    .pipe(Atom.setIdleTTL("15 seconds"))
)

export const activeTimerAtom = Atom.family((orgSlug: string) =>
  Atom.optimistic(activeTimerBaseAtom(orgSlug))
)

export const workTypesForTicketAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.everhour.ticketWorkTypes({
          params: { orgSlug, slug, id }
        })
      })
    )
    .pipe(Atom.setIdleTTL("1 minute"))
})

export const ticketTimeBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.everhour.ticketTime({
          params: { orgSlug, slug, id }
        })
      })
    )
    .pipe(Atom.setIdleTTL("30 seconds"))
})

export const ticketTimeAtom = Atom.family((key: string) =>
  Atom.optimistic(ticketTimeBaseAtom(key))
)

export const startTicketTimerAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitTicketKey(key)
  return Atom.optimisticFn(activeTimerAtom(orgSlug), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn((input: StartTimerInput, get) => {
      const previous = get(activeTimerAtom(orgSlug))
      return Effect.gen(function* () {
        const client = yield* ApiClient
        const timer = yield* client.everhour.startTicketTimer({
          params: { orgSlug, slug, id },
          payload: input
        })
        get.refresh(activeTimerBaseAtom(orgSlug))
        get.refresh(ticketTimeBaseAtom(key))
        for (const previousKey of ticketTimeKeysForTimers(orgSlug, [
          Result.isSuccess(previous) ? previous.value : null
        ])) {
          get.refresh(ticketTimeBaseAtom(previousKey))
        }
        return timer
      })
    })
  })
})

export const startSprintTimerAtom = Atom.family((key: string) => {
  const { orgSlug, slug, id } = splitGroupKey(key)
  return Atom.optimisticFn(activeTimerAtom(orgSlug), {
    reducer: (current) =>
      Result.isSuccess(current)
        ? Result.success(current.value, { waiting: true })
        : current,
    fn: runtime.fn((input: StartSprintTimerInput, get) => {
      const previous = get(activeTimerAtom(orgSlug))
      return Effect.gen(function* () {
        const client = yield* ApiClient
        const timer = yield* client.everhour.startSprintTimer({
          params: { orgSlug, slug, id },
          payload: input
        })
        get.refresh(activeTimerBaseAtom(orgSlug))
        for (const previousKey of ticketTimeKeysForTimers(orgSlug, [
          Result.isSuccess(previous) ? previous.value : null
        ])) {
          get.refresh(ticketTimeBaseAtom(previousKey))
        }
        return timer
      })
    })
  })
})

export const stopTimerAtom = Atom.family((orgSlug: string) =>
  Atom.optimisticFn(activeTimerAtom(orgSlug), {
    reducer: optimisticStopTimer,
    fn: runtime.fn(
      Effect.fn(function* (_input: void, get) {
        const client = yield* ApiClient
        const stopped = yield* client.everhour.stopTimer({
          params: { orgSlug }
        })
        get.refresh(activeTimerBaseAtom(orgSlug))
        for (const stoppedKey of ticketTimeKeysForTimers(orgSlug, [stopped])) {
          get.refresh(ticketTimeBaseAtom(stoppedKey))
        }
        return stopped
      })
    )
  })
)

export const logTimeAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime.fn(
    Effect.fn(function* (input: LogTimeInput, get) {
      const client = yield* ApiClient
      const summary = yield* client.everhour.logTime({
        params: { orgSlug, slug },
        payload: input
      })
      get.refresh(activeTimerBaseAtom(orgSlug))
      if (input.ticketId) {
        get.refresh(
          ticketTimeBaseAtom(ticketKey(orgSlug, slug, input.ticketId))
        )
      }
      return summary
    })
  )
})

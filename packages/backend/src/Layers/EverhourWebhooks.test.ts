import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect } from "vite-plus/test"
import { Db } from "../Services/Db"
import type { EverhourTimeRecord } from "../Services/Everhour"
import {
  EverhourTimeTracking,
  type EverhourTimeTrackingShape
} from "../Services/EverhourTimeTracking"
import { EverhourWebhooks } from "../Services/EverhourWebhooks"
import { EverhourWebhooksLive, parseTimeRecord } from "./EverhourWebhooks"

const unexpected = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`unexpected ${method} call`))

const fakeDb = (
  integration: { projectIntegrationLinkId: string } | undefined
) =>
  Layer.succeed(Db, {
    query: {
      projectEverhourIntegration: {
        findFirst: () => Effect.succeed(integration)
      }
    }
  } as never)

const recordingTimeTracking = (
  calls: Array<{ linkId: string; record: EverhourTimeRecord }>
) =>
  Layer.succeed(EverhourTimeTracking, {
    workTypesForTicket: () => unexpected("workTypesForTicket"),
    startTicketTimer: () => unexpected("startTicketTimer"),
    startSprintTimer: () => unexpected("startSprintTimer"),
    stopTimer: () => unexpected("stopTimer"),
    currentTimer: () => unexpected("currentTimer"),
    logTime: () => unexpected("logTime"),
    ticketTimeSummary: () => unexpected("ticketTimeSummary"),
    applyWebhookTimeEvent: (linkId, record) =>
      Effect.sync(() => {
        calls.push({ linkId, record })
      })
  } satisfies EverhourTimeTrackingShape)

const body = `{
  "event": "api:time:updated",
  "data": {
    "id": 2660155,
    "time": 3600,
    "user": 1304,
    "date": "2018-01-20",
    "task": { "id": "ev:9876543210" },
    "comment": "T-12 — Fix the thing"
  }
}`

const liveDeliveryBody = `{
  "event": "api:time:updated",
  "payload": {
    "id": "ev:188193235916608",
    "data": {
      "user": 1362384,
      "history": [
        {
          "id": 370578249,
          "time": 60,
          "previousTime": 0,
          "action": "TIMER",
          "source": "internal",
          "createdAt": "2024-10-18 13:58:23",
          "createdBy": 1362384
        }
      ],
      "lockReasons": [],
      "isLocked": false,
      "manualTime": 0,
      "id": 214588860,
      "date": "2024-10-18",
      "time": 60,
      "timerTime": 60,
      "task": {
        "id": "ev:188193235916608",
        "type": "task",
        "name": "Project Management",
        "time": { "total": 60, "users": { "1362384": 60 }, "timerTime": 60 }
      },
      "createdAt": "2024-10-18 13:58:23"
    }
  },
  "createdAt": "2024-10-18 13:59:20"
}`

describe("parseTimeRecord", () => {
  it.effect("maps a wrapped time-record payload", () =>
    Effect.sync(() => {
      const record = parseTimeRecord(body)
      expect(record).toEqual({
        id: "2660155",
        taskId: "ev:9876543210",
        userId: "1304",
        seconds: 3600,
        date: "2018-01-20",
        comment: "T-12 — Fix the thing"
      })
    })
  )

  it.effect(
    "maps a live api:time:updated delivery (payload.data nesting)",
    () =>
      Effect.sync(() => {
        const record = parseTimeRecord(liveDeliveryBody)
        expect(record).toEqual({
          id: "214588860",
          taskId: "ev:188193235916608",
          userId: "1362384",
          seconds: 60,
          date: "2024-10-18",
          comment: null
        })
      })
  )

  it.effect("returns null for unparseable bodies", () =>
    Effect.sync(() => {
      expect(parseTimeRecord("not json")).toBeNull()
      expect(parseTimeRecord(`{ "event": "x" }`)).toBeNull()
    })
  )
})

describe("EverhourWebhooks.handle", () => {
  it.effect("dispatches to applyWebhookTimeEvent for a known secret", () =>
    Effect.gen(function* () {
      const webhooks = yield* EverhourWebhooks
      yield* webhooks.handle({ secret: "good", body })
      expect(dispatchedForKnown).toHaveLength(1)
      expect(dispatchedForKnown[0]!.linkId).toBe("link-1")
      expect(dispatchedForKnown[0]!.record.id).toBe("2660155")
    }).pipe(
      Effect.provide(
        EverhourWebhooksLive.pipe(
          Layer.provide(fakeDb({ projectIntegrationLinkId: "link-1" })),
          Layer.provide(recordingTimeTrackingFixture)
        )
      )
    )
  )

  it.effect("ignores deliveries for an unknown secret", () =>
    Effect.gen(function* () {
      const webhooks = yield* EverhourWebhooks
      yield* webhooks.handle({ secret: "bogus", body })
      expect(dispatchedForUnknown).toHaveLength(0)
    }).pipe(
      Effect.provide(
        EverhourWebhooksLive.pipe(
          Layer.provide(fakeDb(undefined)),
          Layer.provide(recordingTimeTrackingFixtureUnknown)
        )
      )
    )
  )
})

const dispatchedForKnown: Array<{
  linkId: string
  record: EverhourTimeRecord
}> = []
const recordingTimeTrackingFixture = recordingTimeTracking(dispatchedForKnown)
const dispatchedForUnknown: Array<{
  linkId: string
  record: EverhourTimeRecord
}> = []
const recordingTimeTrackingFixtureUnknown =
  recordingTimeTracking(dispatchedForUnknown)

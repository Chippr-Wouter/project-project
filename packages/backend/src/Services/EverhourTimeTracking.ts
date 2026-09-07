import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  ActiveTimer,
  EverhourApiKeyMissing,
  EverhourAuthInvalid,
  EverhourConfigMissing,
  EverhourError,
  EverhourRateLimited,
  LogTimeInput,
  NotFound,
  StartSprintTimerInput,
  StartTimerInput,
  TicketTimeSummary,
  WorkTypeOption
} from "@projectproject/shared"
import type { EverhourTimeRecord } from "./Everhour"

export type EverhourTimeTrackingError =
  | NotFound
  | EverhourApiKeyMissing
  | EverhourAuthInvalid
  | EverhourRateLimited
  | EverhourConfigMissing
  | EverhourError

export interface EverhourTimeTrackingShape {
  readonly workTypesForTicket: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: string
  ) => Effect.Effect<ReadonlyArray<WorkTypeOption>, NotFound>
  readonly startTicketTimer: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: string,
    input: StartTimerInput
  ) => Effect.Effect<ActiveTimer, EverhourTimeTrackingError>
  readonly startSprintTimer: (
    orgSlug: string,
    userId: string,
    slug: string,
    groupId: string,
    input: StartSprintTimerInput
  ) => Effect.Effect<ActiveTimer, EverhourTimeTrackingError>
  readonly stopTimer: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<ActiveTimer | null, EverhourTimeTrackingError>
  readonly currentTimer: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<ActiveTimer | null, EverhourTimeTrackingError>
  readonly logTime: (
    orgSlug: string,
    userId: string,
    slug: string,
    input: LogTimeInput
  ) => Effect.Effect<TicketTimeSummary | null, EverhourTimeTrackingError>
  readonly ticketTimeSummary: (
    orgSlug: string,
    userId: string,
    slug: string,
    ticketId: string
  ) => Effect.Effect<TicketTimeSummary, NotFound>
  readonly applyWebhookTimeEvent: (
    projectIntegrationLinkId: string,
    record: EverhourTimeRecord
  ) => Effect.Effect<void>
}

export class EverhourTimeTracking extends Context.Service<
  EverhourTimeTracking,
  EverhourTimeTrackingShape
>()("@projectproject/backend/Services/EverhourTimeTracking") {}

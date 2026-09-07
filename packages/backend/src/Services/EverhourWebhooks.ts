import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"

export interface EverhourWebhookDelivery {
  readonly secret: string
  readonly body: string
}

export interface EverhourWebhooksShape {
  readonly handle: (delivery: EverhourWebhookDelivery) => Effect.Effect<void>
}

export class EverhourWebhooks extends Context.Service<
  EverhourWebhooks,
  EverhourWebhooksShape
>()("@projectproject/backend/Services/EverhourWebhooks") {}

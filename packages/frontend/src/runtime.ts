import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Layer from "effect/Layer"
import * as ApiClient from "@/services/ApiClient"
import * as TicketSync from "@/services/TicketSync"

export const AppLayer = TicketSync.layer.pipe(
  Layer.provideMerge(ApiClient.ApiClient.Default)
)
export const runtime = Atom.runtime(AppLayer)
export const registry = Registry.make()

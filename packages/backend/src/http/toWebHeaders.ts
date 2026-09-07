import type { Headers as PlatformHeaders } from "effect/unstable/http"

export const toWebHeaders = (h: PlatformHeaders.Headers): Headers => {
  const out = new Headers()
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === "string") out.set(k, v)
  }
  return out
}

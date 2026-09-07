// Relative time formatter — "2 hours ago", "yesterday", etc. Used by the
// projects list, dashboard tiles, and anywhere we surface a date.
//
// We deliberately keep this in lib/, not in a component, because the same
// formatter wants to be available outside React (e.g. data tooltips).

import * as DateTime from "effect/DateTime"
import { getLocale } from "@/paraglide/runtime"

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60]
]

export function formatRelative(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(getLocale(), { numeric: "auto" })
  const diff =
    (date.getTime() - DateTime.toEpochMillis(DateTime.nowUnsafe())) / 1000
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diff) >= secs) {
      return rtf.format(Math.round(diff / secs), unit)
    }
  }
  return rtf.format(Math.round(diff), "second")
}

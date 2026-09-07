import * as Effect from "effect/Effect"
import { ApiClient } from "@/services/ApiClient"
import { ticketListQueryToSearch } from "@projectproject/shared"
import type { MentionProvider } from "./registry"

export const ticketMentionProvider: MentionProvider = {
  trigger: "#",
  type: "ticket",
  search: (query, scope) =>
    Effect.gen(function* () {
      if (!scope.orgSlug || !scope.slug) return []
      const client = yield* ApiClient
      const page = yield* client.tickets.list({
        params: { orgSlug: scope.orgSlug, slug: scope.slug },
        query: ticketListQueryToSearch({
          q: query.length > 0 ? query : undefined
        })
      })
      const q = query.toLowerCase()
      return page.items
        .filter(
          (t) =>
            t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map((t) => ({ id: t.id, label: t.title }))
    }).pipe(Effect.orElseSucceed(() => [])),
  renderRow: (c) => (
    <div className="flex items-center gap-2 min-w-0">
      <span className="font-mono shrink-0 whitespace-nowrap">{c.id}</span>
      <span className="text-muted-foreground truncate">{c.label}</span>
    </div>
  )
}

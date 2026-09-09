import * as Effect from "effect/Effect"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import { meAtom } from "@/atoms/auth"
import { MemberAvatar } from "@/components/MemberAvatar"
import type { MentionProvider } from "./registry"

export const userMentionProvider: MentionProvider = {
  trigger: "@",
  type: "user",
  search: (query, scope) =>
    Effect.gen(function* () {
      const q = query.toLowerCase()
      const members = scope.members
      if (members && members.length > 0) {
        const filtered = members.filter((m) => {
          if (!q) return true
          return (
            m.name.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q) ||
            (m.username?.toLowerCase().includes(q) ?? false)
          )
        })
        return filtered.map((m) => ({
          id: m.id,
          label: m.name,
          secondary: m.email,
          image: m.image
        }))
      }
      const registry = yield* Registry.AtomRegistry
      const me = yield* Registry.getResult(registry, meAtom)
      const label = me.name ?? me.id
      if (
        q &&
        !label.toLowerCase().includes(q) &&
        !me.id.toLowerCase().includes(q)
      ) {
        return []
      }
      return [{ id: me.id, label, image: null }]
    }).pipe(Effect.orElseSucceed(() => [])),
  renderRow: (c) => (
    <div className="flex items-center gap-2 min-w-0">
      <MemberAvatar
        member={{
          name: c.label,
          email: c.secondary ?? null,
          image: c.image ?? null
        }}
        size={20}
      />
      <span className="font-medium truncate">{c.label}</span>
      {c.secondary && (
        <span className="text-muted-foreground text-xs truncate">
          {c.secondary}
        </span>
      )}
    </div>
  )
}

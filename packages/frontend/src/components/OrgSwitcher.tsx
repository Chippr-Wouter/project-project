import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { meAtom, setActiveOrganizationAtom } from "@/atoms/auth"
import { userOrgsAtom } from "@/atoms/orgs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { m } from "@/paraglide/messages"

import type { Org } from "@projectproject/shared"

export function OrgSwitcher() {
  const orgsResult = useAtomValue(userOrgsAtom)
  const me = useAtomValue(meAtom)
  const params = useParams({ strict: false }) as { orgSlug?: string }
  const setActive = useAtomSet(setActiveOrganizationAtom("me"))
  const navigate = useNavigate()

  if (!Result.isSuccess(orgsResult)) return null
  const orgs = orgsResult.value
  if (orgs.length <= 1) return null

  const activeSlug =
    params.orgSlug ??
    (Result.isSuccess(me) ? me.value.activeOrgSlug : null) ??
    null

  const sorted = [...orgs].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )
  const current = sorted.find((o) => o.slug === activeSlug) ?? sorted[0]

  const switchTo = (org: Org) => {
    if (org.slug === current.slug) return
    setActive(org.slug)
    void navigate({ to: "/orgs/$orgSlug", params: { orgSlug: org.slug } })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={m.org_switcher_trigger_aria_label()}
            className="ml-auto flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-all duration-100 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
          >
            <span className="min-w-0 truncate">{current.name}</span>
            <ChevronsUpDown
              className="size-3.5 shrink-0 opacity-60"
              strokeWidth={1.75}
            />
          </button>
        }
      />
      <DropdownMenuContent align="end" sideOffset={8} className="w-56">
        <DropdownMenuLabel>{m.org_switcher_current_org()}</DropdownMenuLabel>
        {sorted.map((org) => (
          <DropdownMenuItem
            key={org.slug}
            aria-label={m.org_switcher_switch_aria_label({ name: org.name })}
            onClick={() => switchTo(org)}
            className={
              org.slug === current.slug ? "text-foreground" : undefined
            }
          >
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            {org.slug === current.slug ? (
              <Check className="size-4 shrink-0" strokeWidth={2} />
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={
            <Link to="/welcome">
              <Plus className="size-4" strokeWidth={1.75} />
              {m.org_switcher_create_new()}
            </Link>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

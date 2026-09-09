import { createContext, use, useEffect, type ReactNode } from "react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import {
  figmaRefKey,
  type FigmaRef,
  type TicketId
} from "@projectproject/shared"
import {
  figmaTicketLinksAtom,
  figmaTicketLinksNoTicketKey
} from "@/atoms/figma"
import { ticketKey } from "@/atoms/tickets"

export interface FigmaLinkMetadata {
  readonly name: string
  readonly fileName: string
  readonly thumbnailUrl: string | null
}

export interface FigmaTicketTarget {
  readonly orgSlug: string
  readonly slug: string
  readonly ticketId: TicketId
}

const FigmaTicketContext = createContext<FigmaTicketTarget | null>(null)

export function FigmaTicketProvider({
  target,
  children
}: {
  target: FigmaTicketTarget | null
  children: ReactNode
}) {
  return <FigmaTicketContext value={target}>{children}</FigmaTicketContext>
}

export const useFigmaMetadata = (
  ref: FigmaRef | null
): FigmaLinkMetadata | null => {
  const target = use(FigmaTicketContext)
  const key =
    target === null
      ? figmaTicketLinksNoTicketKey
      : ticketKey(target.orgSlug, target.slug, target.ticketId)
  const result = useAtomValue(figmaTicketLinksAtom(key))
  const refresh = useAtomRefresh(figmaTicketLinksAtom(key))
  const refKey = ref === null ? null : figmaRefKey(ref)
  const metadata =
    refKey === null || !Result.isSuccess(result)
      ? null
      : (result.value.find(
          (link) => `${link.fileKey}/${link.nodeId ?? ""}` === refKey
        ) ?? null)

  useEffect(() => {
    if (refKey === null || metadata?.lastModified != null) return
    let attempts = 0
    refresh()
    const interval = window.setInterval(() => {
      attempts += 1
      refresh()
      if (attempts >= 15) window.clearInterval(interval)
    }, 1_000)
    return () => window.clearInterval(interval)
  }, [metadata?.lastModified, refKey, refresh])

  if (ref === null || !Result.isSuccess(result)) return null
  return metadata
}

import { createContext, use, type ReactNode } from "react"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
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
  if (ref === null || !Result.isSuccess(result)) return null
  const refKey = figmaRefKey(ref)
  return (
    result.value.find(
      (link) => `${link.fileKey}/${link.nodeId ?? ""}` === refKey
    ) ?? null
  )
}

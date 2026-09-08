import { createContext, use, type ReactNode } from "react"
import { Result, useAtomValue } from "@effect-atom/atom-react"
import { figmaRefKey, type FigmaRef, type TicketId } from "@projectproject/shared"
import { figmaTicketLinksAtom } from "@/atoms/figma"
import { ticketKey } from "@/atoms/tickets"

export interface FigmaLinkMetadata {
  readonly name: string
  readonly fileName: string
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
  if (target === null || ref === null) return null
  const result = useAtomValue(
    figmaTicketLinksAtom(
      ticketKey(target.orgSlug, target.slug, target.ticketId)
    )
  )
  if (!Result.isSuccess(result)) return null
  const key = figmaRefKey(ref)
  return (
    result.value.find(
      (link) => `${link.fileKey}/${link.nodeId ?? ""}` === key
    ) ?? null
  )
}

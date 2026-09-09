import * as Exit from "effect/Exit"
import * as Schema from "effect/Schema"
import { TicketId } from "@projectproject/shared"

const branchTicketIdPattern =
  /(?:^|[^\p{L}\p{N}])([A-Za-z][A-Za-z0-9]*-[0-9]+)(?=$|[^\p{L}\p{N}])/gu

const decodeTicketId = Schema.decodeUnknownExit(TicketId)

export const ticketIdsInBranch = (branch: string): ReadonlySet<TicketId> => {
  const ids = new Set<TicketId>()
  for (const match of branch.matchAll(branchTicketIdPattern)) {
    const token = match[1]
    if (token === undefined) continue
    const decoded = decodeTicketId(token.toUpperCase())
    if (Exit.isSuccess(decoded)) ids.add(decoded.value)
  }
  return ids
}

export const branchMentionsTicketId = (branch: string): boolean =>
  ticketIdsInBranch(branch).size > 0

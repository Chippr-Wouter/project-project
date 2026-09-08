import { describe, expect, it } from "vitest"
import { ticketListQueryFromSearch } from "@projectproject/shared"
import {
  supportsReplicaListQuery,
  supportsReplicaCountQuery
} from "./ticketReplicaPrototype"

describe("ticket replica query coverage", () => {
  it("serves complete active metadata with the default ordering", () => {
    const query = ticketListQueryFromSearch({})
    expect(supportsReplicaListQuery(query)).toBe(true)
    expect(supportsReplicaCountQuery(query)).toBe(true)
    expect(
      supportsReplicaListQuery({
        ...query,
        filter: { assignee: ["mine"], status: [], archived: false }
      })
    ).toBe(true)
  })
  it("keeps partial datasets and relation queries on the server", () => {
    const query = ticketListQueryFromSearch({})
    for (const unsupported of [
      { ...query, filter: { archived: true } },
      { ...query, filter: { groupId: [null] } },
      { ...query, filter: { groupId: [] } },
      { ...query, q: "ticket" }
    ]) {
      expect(supportsReplicaListQuery(unsupported)).toBe(false)
      expect(supportsReplicaCountQuery(unsupported)).toBe(false)
    }
    expect(supportsReplicaListQuery({ ...query, cursor: "next-page" })).toBe(
      false
    )
    expect(
      supportsReplicaListQuery({ ...query, sort: { key: "title", dir: "asc" } })
    ).toBe(false)
    expect(
      supportsReplicaListQuery({
        ...query,
        sort: { key: "created", dir: "asc" }
      })
    ).toBe(false)
  })
})

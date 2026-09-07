import { describe, expect, it } from "vite-plus/test"
import * as Schema from "effect/Schema"
import { StatusSlug } from "../schemas/Status"
import { ticketListQueryFromSearch, ticketListQueryToSearch } from "./url"

const s = Schema.decodeUnknownSync(StatusSlug)

describe("ticketListQueryFromSearch", () => {
  it("decodes a flat search record into the composite query", () => {
    const result = ticketListQueryFromSearch({
      status: ["todo", "in_progress"],
      type: ["feat"],
      assignee: ["mine", "unassigned"],
      tags: ["core"],
      q: "hello",
      sort: "created:desc"
    })
    expect(result.filter).toEqual({
      status: ["todo", "in_progress"],
      type: ["feat"],
      assignee: ["mine", null],
      tags: ["core"]
    })
    expect(result.sort).toEqual({ key: "created", dir: "desc" })
    expect(result.q).toBe("hello")
  })

  it("applies the schema default sort when missing", () => {
    const result = ticketListQueryFromSearch({})
    expect(result.sort).toEqual({ key: "created", dir: "desc" })
    expect(result.filter).toBeUndefined()
    expect(result.q).toBeUndefined()
  })

  it("ignores malformed sort and unknown keys, passes slug-shaped status", () => {
    const result = ticketListQueryFromSearch({
      status: "garbage_status",
      sort: "no-colon",
      unrelated: "ignored"
    } as never)
    expect(result.filter?.status).toEqual(["garbage_status"])
    expect(result.sort).toEqual({ key: "created", dir: "desc" })
  })

  it("rejects status values that fail the slug pattern", () => {
    const result = ticketListQueryFromSearch({
      status: "INVALID STATUS!"
    } as never)
    expect(result.filter).toBeUndefined()
  })
})

describe("ticketListQueryToSearch", () => {
  it("encodes a query into a flat search record", () => {
    const search = ticketListQueryToSearch({
      filter: {
        status: [s("todo")],
        assignee: ["mine", null]
      },
      sort: { key: "updated", dir: "desc" },
      q: "abc"
    })
    expect(search).toEqual({
      status: ["todo"],
      assignee: ["mine", "unassigned"],
      sort: "updated:desc",
      q: "abc"
    })
  })

  it("omits the default sort", () => {
    const search = ticketListQueryToSearch({
      sort: { key: "created", dir: "desc" }
    })
    expect(search).toEqual({})
  })

  it("keeps single-element arrays as arrays", () => {
    const search = ticketListQueryToSearch({
      filter: { tags: ["core"] }
    })
    expect(search).toEqual({ tags: ["core"] })
  })

  it("round-trips for non-trivial queries", () => {
    const original = {
      filter: {
        status: [s("todo"), s("in_progress")] as const,
        assignee: ["mine", null, "user_abc"] as const
      },
      sort: { key: "title" as const, dir: "asc" as const },
      q: "search term"
    }
    const search = ticketListQueryToSearch(original)
    const decoded = ticketListQueryFromSearch(search)
    expect(decoded.filter?.status).toEqual(original.filter.status)
    expect(decoded.filter?.assignee).toEqual(original.filter.assignee)
    expect(decoded.sort).toEqual(original.sort)
    expect(decoded.q).toBe(original.q)
  })

  it("encodes groupId=null as 'unassigned' sentinel and round-trips", () => {
    const search = ticketListQueryToSearch({
      filter: { groupId: [null] }
    })
    expect(search).toEqual({ groupId: ["unassigned"] })
    const decoded = ticketListQueryFromSearch(search)
    expect(decoded.filter?.groupId).toEqual([null])
  })

  it("mixes null and real GroupIds through encode/decode", () => {
    const search = ticketListQueryToSearch({
      filter: { groupId: [null, "G-7" as never] }
    })
    expect(search).toEqual({ groupId: ["unassigned", "G-7"] })
    const decoded = ticketListQueryFromSearch(search)
    expect(decoded.filter?.groupId).toEqual([null, "G-7"])
  })
})

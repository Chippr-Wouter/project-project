import "@effect/sql-drizzle/Pg"
import { it } from "@effect/vitest"
import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaNotConnected,
  NotFound,
  StorageNotConnected
} from "@projectproject/shared"
import { drizzle } from "drizzle-orm/pg-proxy"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { describe, expect, vi } from "vitest"
import * as schema from "../db/schema"
import { CurrentOrg } from "../Services/CurrentOrg"
import { Db } from "../Services/Db"
import { Figma } from "../Services/Figma"
import { FigmaIntegrations } from "../Services/FigmaIntegrations"
import {
  devResourceName,
  FigmaLinks,
  planFigmaReferences,
  shouldBacklink
} from "../Services/FigmaLinks"
import { OrgStorage } from "../Services/OrgStorage"
import { Projects } from "../Services/Projects"
import { S3Storage } from "../Services/S3Storage"
import {
  needsFigmaMetadata,
  figmaCheckReason,
  figmaLinkMetadata,
  figmaThumbnailKey,
  FigmaLinksLive
} from "./FigmaLinks"

describe("devResourceName", () => {
  it("names the resource after the ticket", () => {
    expect(devResourceName("T-51", "Figma integration")).toBe(
      "T-51 · Figma integration"
    )
  })

  it("truncates a very long title", () => {
    const name = devResourceName("T-51", "x".repeat(200))
    expect(name.length).toBeLessThanOrEqual(100)
    expect(name.startsWith("T-51 · ")).toBe(true)
  })
})

describe("shouldBacklink", () => {
  it("backlinks a node-level reference", () => {
    expect(shouldBacklink({ nodeId: "1:2" })).toBe(true)
  })

  it("skips a file-level reference", () => {
    expect(shouldBacklink({ nodeId: null })).toBe(false)
  })
})

describe("planFigmaReferences", () => {
  it("adds a reference that appears in the body", () => {
    expect(
      planFigmaReferences({
        existing: new Set(),
        referenced: new Set(["k/1:2"])
      })
    ).toEqual({ added: ["k/1:2"], removed: [] })
  })

  it("removes a reference that left the body", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["k/1:2"]),
        referenced: new Set()
      })
    ).toEqual({ added: [], removed: ["k/1:2"] })
  })

  it("leaves an unchanged reference alone", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["k/1:2"]),
        referenced: new Set(["k/1:2"])
      })
    ).toEqual({ added: [], removed: [] })
  })

  it("handles a simultaneous add and remove", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["k/1:2"]),
        referenced: new Set(["k/3:4"])
      })
    ).toEqual({ added: ["k/3:4"], removed: ["k/1:2"] })
  })

  it("removes everything when the body is emptied", () => {
    expect(
      planFigmaReferences({
        existing: new Set(["a/1:2", "b/3:4"]),
        referenced: new Set()
      })
    ).toEqual({ added: [], removed: ["a/1:2", "b/3:4"] })
  })
})

describe("figmaThumbnailKey", () => {
  it("keys a node-level ref under the org and file", () => {
    expect(
      figmaThumbnailKey({
        keyPrefix: null,
        orgSlug: "acme",
        fileKey: "FILEKEY123",
        nodeId: "12:34"
      })
    ).toBe("orgs/acme/figma/FILEKEY123/12-34.png")
  })

  it("keys a file-level ref distinctly from any node", () => {
    expect(
      figmaThumbnailKey({
        keyPrefix: "pp",
        orgSlug: "acme",
        fileKey: "FILEKEY123",
        nodeId: null
      })
    ).toBe("pp/orgs/acme/figma/FILEKEY123/file.png")
  })
})

describe("figmaCheckReason", () => {
  it("never leaks a message from the figma error body", () => {
    expect(
      figmaCheckReason(new FigmaError({ reason: "token abc123 rejected" }))
    ).toBe("figma_unavailable")
  })

  it("names the auth failure without a credential", () => {
    expect(figmaCheckReason(new FigmaAuthInvalid())).toBe("figma_auth_invalid")
  })
})

describe("needsFigmaMetadata", () => {
  const at = (iso: string): Date =>
    DateTime.toDate(DateTime.unsafeMake(Date.parse(iso)))

  const now = at("2026-09-04T12:00:00Z")

  it("resolves a link that has never been fetched", () => {
    expect(
      needsFigmaMetadata({ fetchedAt: null, lastCheckStatus: null }, now)
    ).toBe(true)
  })

  it("retries a link whose last check errored", () => {
    expect(
      needsFigmaMetadata(
        {
          fetchedAt: at("2026-09-04T11:59:00Z"),
          lastCheckStatus: "error"
        },
        now
      )
    ).toBe(true)
  })

  it("skips a link fetched successfully within the day", () => {
    expect(
      needsFigmaMetadata(
        { fetchedAt: at("2026-09-04T11:00:00Z"), lastCheckStatus: "ok" },
        now
      )
    ).toBe(false)
  })

  it("refreshes a link fetched more than a day ago", () => {
    expect(
      needsFigmaMetadata(
        { fetchedAt: at("2026-09-03T11:00:00Z"), lastCheckStatus: "ok" },
        now
      )
    ).toBe(true)
  })
})

describe("figmaLinkMetadata", () => {
  it("falls back to the file name when the node name is unresolved", () => {
    expect(
      figmaLinkMetadata({
        fileKey: "FILEKEY123",
        nodeId: "1:2",
        name: null,
        fileName: "Design System",
        lastModified: null,
        thumbnailUrl: null
      }).name
    ).toBe("Design System")
  })

  it("falls back to the file key when nothing is resolved yet", () => {
    const metadata = figmaLinkMetadata({
      fileKey: "FILEKEY123",
      nodeId: null,
      name: null,
      fileName: null,
      lastModified: null,
      thumbnailUrl: null
    })
    expect(metadata.name).toBe("FILEKEY123")
    expect(metadata.fileName).toBe("FILEKEY123")
  })

  it("prefers the node name over the file name", () => {
    expect(
      figmaLinkMetadata({
        fileKey: "FILEKEY123",
        nodeId: "1:2",
        name: "Checkout frame",
        fileName: "Design System",
        lastModified: null,
        thumbnailUrl: null
      }).name
    ).toBe("Checkout frame")
  })
})

const BODY =
  "see https://www.figma.com/design/FILEKEY123/Spec?node-id=12-34 please"

const proxyDb = (
  respond: (sql: string) => ReadonlyArray<ReadonlyArray<unknown>>
) => {
  const calls: Array<string> = []
  const db = drizzle(
    async (sql: string) => {
      calls.push(sql)
      return { rows: respond(sql).map((row) => [...row]) }
    },
    { schema }
  )
  return { calls, db }
}

const emptyDb = () => proxyDb(() => [])

const recordingDb = (
  respond: (sql: string) => ReadonlyArray<ReadonlyArray<unknown>>
) => {
  const calls: Array<string> = []
  const params: Array<unknown> = []
  const db = drizzle(
    async (sql: string, args: Array<unknown>) => {
      calls.push(sql)
      params.push(...args)
      return { rows: respond(sql).map((row) => [...row]) }
    },
    { schema }
  )
  return { calls, params, db }
}

const JOINED = 'inner join "figma_link_index"'

const referencedLink = (input: {
  readonly fetchedAt: string | null
  readonly lastCheckStatus: string | null
  readonly devResourceId?: string | null
}) => [
  [
    "link-1",
    "FILEKEY123",
    "12:34",
    input.fetchedAt,
    input.lastCheckStatus,
    input.devResourceId ?? null
  ]
]

const failingDb = () => {
  const db = drizzle(
    async () => {
      throw new Error('relation "figma_reference" does not exist')
    },
    { schema }
  )
  return { calls: [] as Array<string>, db }
}

const harness = (input: {
  readonly db: ReturnType<typeof emptyDb>["db"]
  readonly credential?: Effect.Effect<
    never,
    FigmaAuthInvalid | FigmaNotConnected
  >
  readonly figma?: Partial<Record<string, unknown>>
  readonly storage?: Effect.Effect<unknown, FigmaError | StorageNotConnected>
  readonly currentOrg?: Effect.Effect<unknown, NotFound>
  readonly projectMember?: Effect.Effect<unknown, NotFound>
}) =>
  FigmaLinksLive.pipe(
    Layer.provide(Layer.succeed(Db, input.db as never)),
    Layer.provide(
      Layer.succeed(CurrentOrg, {
        resolve: () => input.currentOrg ?? Effect.fail(new NotFound())
      } as never)
    ),
    Layer.provide(
      Layer.succeed(FigmaIntegrations, {
        credentialFor: () =>
          input.credential ??
          Effect.succeed({ _tag: "FigmaToken", token: "secret-pat" })
      } as never)
    ),
    Layer.provide(
      Layer.succeed(Figma, {
        getFile: () => Effect.fail(new FigmaAuthInvalid()),
        getNodeName: () => Effect.fail(new FigmaAuthInvalid()),
        renderNode: () => Effect.fail(new FigmaAuthInvalid()),
        ...input.figma
      } as never)
    ),
    Layer.provide(
      Layer.succeed(OrgStorage, {
        requireConnection: () =>
          input.storage ?? Effect.fail(new FigmaError({ reason: "no storage" }))
      } as never)
    ),
    Layer.provide(
      Layer.succeed(Projects, {
        requireMember: () => input.projectMember ?? Effect.fail(new NotFound())
      } as never)
    ),
    Layer.provide(
      Layer.succeed(S3Storage, {
        presignPut: () => Effect.succeed("https://signed.example/put"),
        presignGet: () => Effect.succeed("https://signed.example/get")
      } as never)
    )
  )

const reconcile = (
  layer: Layer.Layer<FigmaLinks>,
  body: string,
  title = "Fix login bug"
) =>
  FigmaLinks.pipe(
    Effect.flatMap((links) =>
      Effect.exit(links.reconcileTicket("acme", "web", "WEB-1", title, body))
    ),
    Effect.provide(layer)
  )

describe("reconcileTicket never fails a ticket save", () => {
  it.effect("succeeds when figma rejects the credential", () =>
    Effect.gen(function* () {
      const { db } = proxyDb((sql) =>
        sql.startsWith("select") && sql.includes("project_index")
          ? [["org-1"]]
          : sql.startsWith("insert") && sql.includes("figma_link_index")
            ? [["link-1"]]
            : []
      )
      const exit = yield* reconcile(harness({ db }), BODY)
      expect(exit._tag).toBe("Success")
    })
  )

  it.live(
    "succeeds and records a self-describing status when the project has no figma connection",
    () =>
      Effect.gen(function* () {
        const { db, params } = recordingDb((sql) =>
          sql.startsWith("select") && sql.includes("project_index")
            ? [["org-1"]]
            : sql.startsWith('insert into "figma_link_index"')
              ? [["link-1"]]
              : []
        )
        const exit = yield* reconcile(
          harness({ db, credential: Effect.fail(new FigmaNotConnected()) }),
          BODY
        )
        yield* Effect.sleep("100 millis")
        expect(exit._tag).toBe("Success")
        expect(params).toContain("figma_not_connected")
        expect(params).not.toContain("secret-pat")
      })
  )

  it.effect("succeeds when every figma reference table query fails", () =>
    Effect.gen(function* () {
      const exit = yield* reconcile(harness({ db: failingDb().db }), BODY)
      expect(exit._tag).toBe("Success")
    })
  )

  it.effect("succeeds on the delete path that retracts every reference", () =>
    Effect.gen(function* () {
      const exit = yield* reconcile(harness({ db: failingDb().db }), "")
      expect(exit._tag).toBe("Success")
    })
  )

  it.effect("writes nothing when the body has no figma link", () =>
    Effect.gen(function* () {
      const { calls, db } = emptyDb()
      const exit = yield* reconcile(harness({ db }), "no links here")
      expect(exit._tag).toBe("Success")
      expect(calls.filter((sql) => !sql.startsWith("select"))).toEqual([])
    })
  )
})

describe("reconcileTicket resolves references it did not just add", () => {
  it.live(
    "resolves an existing reference whose metadata never landed, with nothing newly added",
    () =>
      Effect.gen(function* () {
        const { calls, params, db } = recordingDb((sql) =>
          sql.includes(JOINED)
            ? referencedLink({ fetchedAt: null, lastCheckStatus: null })
            : []
        )
        const exit = yield* reconcile(harness({ db }), BODY)
        yield* Effect.sleep("100 millis")

        expect(exit._tag).toBe("Success")
        expect(
          calls.filter((sql) => sql.startsWith('insert into "figma_reference"'))
        ).toEqual([])
        expect(params).toContain("figma_auth_invalid")
      })
  )

  it.live(
    "retries an existing reference whose last check recorded a missing connection",
    () =>
      Effect.gen(function* () {
        const { params, db } = recordingDb((sql) =>
          sql.includes(JOINED)
            ? referencedLink({
                fetchedAt: "2026-09-04T11:59:00.000Z",
                lastCheckStatus: "error"
              })
            : []
        )
        yield* reconcile(harness({ db }), BODY)
        yield* Effect.sleep("100 millis")

        expect(params).toContain("figma_auth_invalid")
      })
  )

  it.live(
    "never re-fetches an existing reference whose metadata is fresh",
    () =>
      Effect.gen(function* () {
        const fetchSpy = vi.fn(() => Promise.reject(new Error("no network")))
        vi.stubGlobal("fetch", fetchSpy)
        const getFile = vi.fn(() => Effect.fail(new FigmaAuthInvalid()))
        const fresh = DateTime.formatIso(
          DateTime.subtract(yield* DateTime.now, { minutes: 1 })
        )
        const { calls, db } = recordingDb((sql) =>
          sql.includes(JOINED)
            ? referencedLink({ fetchedAt: fresh, lastCheckStatus: "ok" })
            : []
        )

        const exit = yield* reconcile(harness({ db, figma: { getFile } }), BODY)
        yield* Effect.sleep("100 millis")
        vi.unstubAllGlobals()

        expect(exit._tag).toBe("Success")
        expect(getFile).not.toHaveBeenCalled()
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(
          calls.filter((sql) => sql.startsWith('update "figma_link_index"'))
        ).toEqual([])
      })
  )
})

describe("reconcileTicket link index lookup", () => {
  it.effect(
    "matches a file-level ref with is null so the nulls-not-distinct constraint updates instead of violating",
    () =>
      Effect.gen(function* () {
        const { calls, db } = proxyDb((sql) =>
          sql.startsWith("select") && sql.includes("project_index")
            ? [["org-1"]]
            : []
        )
        yield* reconcile(
          harness({ db }),
          "https://www.figma.com/design/FILEKEY123/Spec"
        )
        const lookup = calls.find(
          (sql) =>
            sql.startsWith("select") && sql.includes('from "figma_link_index"')
        )
        expect(lookup).toContain('"node_id" is null')
      })
  )

  it.effect("matches a node-level ref by equality", () =>
    Effect.gen(function* () {
      const { calls, db } = proxyDb((sql) =>
        sql.startsWith("select") && sql.includes("project_index")
          ? [["org-1"]]
          : []
      )
      yield* reconcile(harness({ db }), BODY)
      const lookup = calls.find(
        (sql) =>
          sql.startsWith("select") && sql.includes('from "figma_link_index"')
      )
      expect(lookup).toContain('"node_id" = ')
    })
  )

  it.effect(
    "targets the same triple on conflict so a concurrent insert updates",
    () =>
      Effect.gen(function* () {
        const { calls, db } = proxyDb((sql) =>
          sql.startsWith("select") && sql.includes("project_index")
            ? [["org-1"]]
            : []
        )
        yield* reconcile(harness({ db }), BODY)
        const insert = calls.find((sql) =>
          sql.startsWith('insert into "figma_link_index"')
        )
        expect(insert).toContain(
          'on conflict ("org_slug","file_key","node_id") do update set'
        )
      })
  )
})

describe("reconcileTicket metadata resolution", () => {
  it.live("records an error status without logging the credential", () =>
    Effect.gen(function* () {
      const params: Array<unknown> = []
      const db = drizzle(
        async (sql: string, args: Array<unknown>) => {
          params.push(...args)
          if (sql.startsWith("select") && sql.includes("project_index")) {
            return { rows: [["org-1"]] }
          }
          if (sql.startsWith('insert into "figma_link_index"')) {
            return { rows: [["link-1"]] }
          }
          return { rows: [] }
        },
        { schema }
      )
      yield* reconcile(harness({ db: db as never }), BODY)
      yield* Effect.sleep("100 millis")
      expect(params).not.toContain("secret-pat")
      expect(params).toContain("figma_auth_invalid")
    })
  )
})

describe("reconcileTicket dev mode backlink", () => {
  it.live(
    "creates a figma dev resource for a newly added node-level reference and persists the id",
    () =>
      Effect.gen(function* () {
        const createDevResource = vi.fn(
          (
            _credential: unknown,
            _input: {
              readonly fileKey: string
              readonly nodeId: string
              readonly name: string
              readonly url: string
            }
          ) => Effect.succeed("dev-99")
        )
        const { params, db } = recordingDb((sql) => {
          if (sql.startsWith("select") && sql.includes("project_index")) {
            return [["org-1"]]
          }
          if (sql.startsWith('insert into "figma_link_index"')) {
            return [["link-1"]]
          }
          return []
        })
        const exit = yield* reconcile(
          harness({ db, figma: { createDevResource } }),
          BODY
        )
        yield* Effect.sleep("100 millis")

        expect(exit._tag).toBe("Success")
        expect(createDevResource).toHaveBeenCalledTimes(1)
        const [, input] = createDevResource.mock.calls[0]
        expect(input.fileKey).toBe("FILEKEY123")
        expect(input.nodeId).toBe("12:34")
        expect(input.name.startsWith("WEB-1 · ")).toBe(true)
        expect(params).toContain("dev-99")
      })
  )

  it.live(
    "backlinks a newly created ticket's figma link on the very first save, with no second edit",
    () =>
      Effect.gen(function* () {
        const createDevResource = vi.fn(
          (
            _credential: unknown,
            _input: {
              readonly fileKey: string
              readonly nodeId: string
              readonly name: string
              readonly url: string
            }
          ) => Effect.succeed("dev-42")
        )
        const { params, db } = recordingDb((sql) => {
          if (sql.startsWith("select") && sql.includes("project_index")) {
            return [["org-1"]]
          }
          if (sql.startsWith('insert into "figma_link_index"')) {
            return [["link-1"]]
          }
          return []
        })
        const exit = yield* reconcile(
          harness({ db, figma: { createDevResource } }),
          BODY,
          "Brand new ticket"
        )
        yield* Effect.sleep("100 millis")

        expect(exit._tag).toBe("Success")
        expect(createDevResource).toHaveBeenCalledTimes(1)
        const [, input] = createDevResource.mock.calls[0]
        expect(input.name).toBe("WEB-1 · Brand new ticket")
        expect(params).toContain("dev-42")
      })
  )

  it.live(
    "does not create a dev resource for a file-level reference",
    () =>
      Effect.gen(function* () {
        const createDevResource = vi.fn(() => Effect.succeed("dev-1"))
        const { db } = recordingDb((sql) => {
          if (sql.startsWith("select") && sql.includes("project_index")) {
            return [["org-1"]]
          }
          if (sql.startsWith('insert into "figma_link_index"')) {
            return [["link-1"]]
          }
          return []
        })
        const exit = yield* reconcile(
          harness({ db, figma: { createDevResource } }),
          "https://www.figma.com/design/FILEKEY123/Spec"
        )
        yield* Effect.sleep("100 millis")

        expect(exit._tag).toBe("Success")
        expect(createDevResource).not.toHaveBeenCalled()
      })
  )

  it.effect(
    "does not fail the ticket save when creating a dev resource fails",
    () =>
      Effect.gen(function* () {
        const { db } = proxyDb((sql) =>
          sql.startsWith("select") && sql.includes("project_index")
            ? [["org-1"]]
            : sql.startsWith('insert into "figma_link_index"')
              ? [["link-1"]]
              : []
        )
        const exit = yield* reconcile(
          harness({
            db,
            figma: {
              createDevResource: () => Effect.fail(new FigmaAuthInvalid())
            }
          }),
          BODY
        )
        expect(exit._tag).toBe("Success")
      })
  )

  it.live(
    "deletes the figma dev resource before removing the reference row",
    () =>
      Effect.gen(function* () {
        const order: Array<string> = []
        const deleteDevResource = vi.fn(() => {
          order.push("figma-delete")
          return Effect.void
        })
        const { db } = recordingDb((sql) => {
          if (sql.includes(JOINED)) {
            return referencedLink({
              fetchedAt: null,
              lastCheckStatus: null,
              devResourceId: "dev-1"
            })
          }
          if (sql.startsWith('delete from "figma_reference"')) {
            order.push("db-delete")
          }
          return []
        })
        const exit = yield* reconcile(
          harness({ db, figma: { deleteDevResource } }),
          ""
        )
        yield* Effect.sleep("100 millis")

        expect(exit._tag).toBe("Success")
        expect(deleteDevResource).toHaveBeenCalledWith(
          expect.anything(),
          "FILEKEY123",
          "dev-1"
        )
        expect(order).toEqual(["figma-delete", "db-delete"])
      })
  )

  it.live(
    "issues the DELETE for a reference whose dev resource id came from adopting an existing Figma resource",
    () =>
      Effect.gen(function* () {
        const order: Array<string> = []
        const deleteDevResource = vi.fn(() => {
          order.push("figma-delete")
          return Effect.void
        })
        const { db } = recordingDb((sql) => {
          if (sql.includes(JOINED)) {
            return referencedLink({
              fetchedAt: null,
              lastCheckStatus: null,
              devResourceId: "adopted-existing-dev-resource"
            })
          }
          if (sql.startsWith('delete from "figma_reference"')) {
            order.push("db-delete")
          }
          return []
        })
        const exit = yield* reconcile(
          harness({ db, figma: { deleteDevResource } }),
          ""
        )
        yield* Effect.sleep("100 millis")

        expect(exit._tag).toBe("Success")
        expect(deleteDevResource).toHaveBeenCalledWith(
          expect.anything(),
          "FILEKEY123",
          "adopted-existing-dev-resource"
        )
        expect(order).toEqual(["figma-delete", "db-delete"])
      })
  )
})

describe("resolveThumbnailUrl", () => {
  const resolve = (layer: Layer.Layer<FigmaLinks>) =>
    FigmaLinks.pipe(
      Effect.flatMap((links) =>
        Effect.exit(links.resolveThumbnailUrl("acme", "user-1", "link-1"))
      ),
      Effect.provide(layer)
    )

  it.effect("gives a project member a freshly signed thumbnail URL", () =>
    Effect.gen(function* () {
      const { db } = proxyDb((sql) =>
        sql.includes('from "figma_link_index"')
          ? [["thumb-key.png", "web"]]
          : []
      )
      const exit = yield* resolve(
        harness({
          db,
          projectMember: Effect.succeed({} as never),
          storage: Effect.succeed({} as never)
        })
      )
      expect(exit._tag).toBe("Success")
      if (exit._tag === "Success") {
        expect(exit.value).toBe("https://signed.example/get")
      }
    })
  )

  it.effect(
    "refuses an org member who is not a member of the referencing project",
    () =>
      Effect.gen(function* () {
        const { db } = proxyDb((sql) =>
          sql.includes('from "figma_link_index"')
            ? [["thumb-key.png", "web"]]
            : []
        )
        const exit = yield* resolve(
          harness({
            db,
            projectMember: Effect.fail(new NotFound()),
            currentOrg: Effect.succeed({
              organizationId: "org-1",
              orgSlug: "acme",
              role: "member"
            })
          })
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          expect(exit.cause.toString()).toContain("Forbidden")
        }
      })
  )

  it.effect("refuses a user who is not a member of the org at all", () =>
    Effect.gen(function* () {
      const { db } = proxyDb((sql) =>
        sql.includes('from "figma_link_index"')
          ? [["thumb-key.png", "web"]]
          : []
      )
      const exit = yield* resolve(
        harness({
          db,
          projectMember: Effect.fail(new NotFound()),
          currentOrg: Effect.fail(new NotFound())
        })
      )
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(exit.cause.toString()).toContain("NotFound")
      }
    })
  )

  it.effect("404s cleanly when the link has no cached thumbnail yet", () =>
    Effect.gen(function* () {
      const { db } = proxyDb((sql) =>
        sql.includes('from "figma_link_index"') ? [[null, "web"]] : []
      )
      const exit = yield* resolve(
        harness({ db, projectMember: Effect.succeed({} as never) })
      )
      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") {
        expect(exit.cause.toString()).toContain("NotFound")
      }
    })
  )

  it.effect(
    "treats a disconnected org storage as a normal state, not a server error",
    () =>
      Effect.gen(function* () {
        const { db } = proxyDb((sql) =>
          sql.includes('from "figma_link_index"')
            ? [["thumb-key.png", "web"]]
            : []
        )
        const exit = yield* resolve(
          harness({
            db,
            projectMember: Effect.succeed({} as never),
            storage: Effect.fail(new StorageNotConnected())
          })
        )
        expect(exit._tag).toBe("Failure")
        if (exit._tag === "Failure") {
          expect(exit.cause.toString()).toContain("StorageNotConnected")
        }
      })
  )
})

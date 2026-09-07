import { describe, expect, test } from "vite-plus/test"
import * as Effect from "effect/Effect"
import * as DateTime from "effect/DateTime"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Schema from "effect/Schema"
import {
  BranchNotFound,
  Forbidden,
  GroupId,
  NotFound,
  SprintCompletedImmutable,
  TicketId,
  type User
} from "@projectproject/shared"
import { currentUserStorage } from "./currentUserStorage"
import { Comments, type CommentsShape } from "../Services/Comments"
import { Tickets, type TicketsShape } from "../Services/Tickets"
import { Projects, type ProjectsShape } from "../Services/Projects"
import { Groups } from "../Services/Groups"
import { Tags } from "../Services/Tags"
import { Users } from "../Services/Users"
import { BetterAuth } from "../Services/BetterAuth"
import { ProjectDocs, type ProjectDocsShape } from "../Services/ProjectDocs"
import { GroupDocs, type GroupDocsShape } from "../Services/GroupDocs"
import { TicketDocs, type TicketDocsShape } from "../Services/TicketDocs"
import {
  TicketIndex,
  type TicketIndexProject,
  type TicketIndexShape
} from "../Services/TicketIndex"
import { registerAllTools } from "./dispatch"
import { handlers } from "./handlers"

const decodeTicketId = Schema.decodeUnknownSync(TicketId)
const isoDate = (s: string) => DateTime.toDate(DateTime.makeUnsafe(s))

const fakeTicket = {
  id: decodeTicketId("T-1"),
  title: "first",
  status: "todo" as const,
  type: "feat" as const,
  priority: "med" as const,
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  gitState: { tag: "no_branch" as const },
  assignees: [],
  archivedAt: null,
  createdBy: "u-1",
  createdAt: isoDate("2026-05-01T00:00:00.000Z"),
  updatedAt: isoDate("2026-05-10T00:00:00.000Z")
}

const capturedListLimits: Array<number | undefined> = []

const TicketsStub = Layer.succeed(Tickets, {
  list: (_o: any, _u: any, _s: any, _q: any, limit?: number) => {
    capturedListLimits.push(limit)
    const all = Array.from({ length: 25 }, (_, i) => ({
      ...fakeTicket,
      id: decodeTicketId(`T-${i + 1}`)
    }))
    const effective = limit ?? all.length
    return Effect.succeed({
      items: all.slice(0, effective),
      nextCursor: effective < all.length ? "cursor-next" : null
    })
  }
} as unknown as TicketsShape)

const fakeUser = { id: "u-1" } as User
const withFakeUser = <T>(fn: () => Promise<T>) =>
  currentUserStorage.run(fakeUser, fn)
const EmptyStub = <T>(tag: T) => Layer.succeed(tag as any, {} as any)

const ProjectsStub = Layer.succeed(Projects, {
  requireMember: (_o: any, _u: any, _s: any) =>
    Effect.succeed({ role: "admin" } as any),
  requireRole: (_o: any, _u: any, _s: any) =>
    Effect.succeed({ role: "admin" } as any)
} as unknown as ProjectsShape)

const ticketIndexProject: TicketIndexProject = {
  orgSlug: "acme",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "demo"
}

const TicketIndexStub = Layer.succeed(TicketIndex, {
  projectFor: (_o: any, _s: any) => Effect.succeed(ticketIndexProject),
  reconcileProject: (project: TicketIndexProject, options?: any) =>
    Effect.succeed({
      project,
      drift: { missing: ["T-2"], orphaned: ["T-9"], stale: ["T-1"] },
      rebuilt: options?.force === true,
      indexed: 3,
      skipped: 1
    })
} as unknown as TicketIndexShape)

const ProjectDocsStub = Layer.succeed(ProjectDocs, {
  readRaw: (_o: any, _s: any) =>
    Effect.succeed({
      path: "orgs/acme/projects/demo/project.md",
      content: "---\nslug: demo\n---\n# Demo\n"
    })
} as unknown as ProjectDocsShape)

const GroupDocsStub = Layer.succeed(GroupDocs, {
  readRaw: (_o: any, _s: any, _id: any) =>
    Effect.succeed({
      path: "orgs/acme/projects/demo/groups/G-1.md",
      content: "---\nid: G-1\n---\n# Sprint 1\n"
    })
} as unknown as GroupDocsShape)

const TicketDocsStub = Layer.succeed(TicketDocs, {
  readRaw: (_o: any, _s: any, _id: any) =>
    Effect.succeed({
      path: "orgs/acme/projects/demo/tickets/T-1.md",
      content: "---\nid: T-1\n---\n# Fix it\n"
    })
} as unknown as TicketDocsShape)

const TestLayer = Layer.mergeAll(
  TicketsStub,
  ProjectsStub,
  EmptyStub(Comments),
  EmptyStub(Groups),
  EmptyStub(Tags),
  EmptyStub(Users),
  EmptyStub(BetterAuth),
  ProjectDocsStub,
  GroupDocsStub,
  TicketDocsStub,
  TicketIndexStub
)

describe("MCP dispatcher → list_tickets", () => {
  test("threads the requested limit through to Tickets.list", async () => {
    capturedListLimits.length = 0
    const runtime = ManagedRuntime.make(TestLayer)

    const registered = new Map<
      string,
      (input: unknown) => Promise<{
        content: ReadonlyArray<{ type: "text"; text: string }>
        isError?: boolean
      }>
    >()
    const fakeServer = {
      registerTool: (
        name: string,
        _meta: unknown,
        cb: (input: unknown) => Promise<any>
      ) => {
        registered.set(name, cb)
      }
    } as any

    registerAllTools(fakeServer, runtime as any, handlers as any)

    const cb = registered.get("list_tickets")
    expect(cb).toBeDefined()
    const result = await withFakeUser(() =>
      cb!({ orgSlug: "acme", projectSlug: "demo", limit: 10 })
    )

    expect(result.isError).toBeUndefined()
    const text = result.content[0].text
    const payload = JSON.parse(text)
    expect(capturedListLimits).toEqual([10])
    expect(payload.items).toHaveLength(10)
    expect(payload.items[0].id).toBe("T-1")
    expect(payload.nextCursor).toBe("cursor-next")

    await runtime.dispose()
  })
})

describe("MCP dispatcher → doc tools", () => {
  test("get_project_doc returns DocFile-shaped JSON envelope", async () => {
    const runtime = ManagedRuntime.make(TestLayer)
    const registered = new Map<
      string,
      (input: unknown) => Promise<{
        content: ReadonlyArray<{ type: "text"; text: string }>
        isError?: boolean
      }>
    >()
    const fakeServer = {
      registerTool: (
        name: string,
        _meta: unknown,
        cb: (input: unknown) => Promise<any>
      ) => {
        registered.set(name, cb)
      }
    } as any

    registerAllTools(fakeServer, runtime as any, handlers as any)

    const cb = registered.get("get_project_doc")
    expect(cb).toBeDefined()
    const result = await withFakeUser(() =>
      cb!({ orgSlug: "acme", projectSlug: "demo" })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      path: "orgs/acme/projects/demo/project.md",
      content: "---\nslug: demo\n---\n# Demo\n"
    })

    await runtime.dispose()
  })

  test("get_group_doc returns DocFile-shaped JSON envelope", async () => {
    const runtime = ManagedRuntime.make(TestLayer)
    const registered = new Map<string, (i: unknown) => Promise<any>>()
    const fakeServer = {
      registerTool: (name: string, _m: unknown, cb: any) => {
        registered.set(name, cb)
      }
    } as any
    registerAllTools(fakeServer, runtime as any, handlers as any)

    const cb = registered.get("get_group_doc")
    expect(cb).toBeDefined()
    const result = await withFakeUser(() =>
      cb!({ orgSlug: "acme", projectSlug: "demo", id: "G-1" })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.path).toBe("orgs/acme/projects/demo/groups/G-1.md")
    expect(payload.content).toContain("# Sprint 1")

    await runtime.dispose()
  })

  test("get_ticket_doc returns DocFile-shaped JSON envelope", async () => {
    const runtime = ManagedRuntime.make(TestLayer)
    const registered = new Map<string, (i: unknown) => Promise<any>>()
    const fakeServer = {
      registerTool: (name: string, _m: unknown, cb: any) => {
        registered.set(name, cb)
      }
    } as any
    registerAllTools(fakeServer, runtime as any, handlers as any)

    const cb = registered.get("get_ticket_doc")
    expect(cb).toBeDefined()
    const result = await withFakeUser(() =>
      cb!({ orgSlug: "acme", projectSlug: "demo", id: "T-1" })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.path).toBe("orgs/acme/projects/demo/tickets/T-1.md")
    expect(payload.content).toContain("# Fix it")

    await runtime.dispose()
  })

  test.skip("placeholder", () => {})
})

describe("MCP dispatcher → write tools", () => {
  const fakeTicketDetail = {
    ...fakeTicket,
    body: "## Steps\n- repro\n"
  }

  const captured: {
    create?: any
    update?: any
    attach?: any
    createComment?: any
  } = {}

  const WriteTicketsStub = Layer.succeed(Tickets, {
    create: (_o: any, _u: any, _s: any, input: any) => {
      captured.create = input
      return Effect.succeed({ ...fakeTicketDetail, ...input })
    },
    update: (_o: any, _u: any, _s: any, _id: any, input: any) => {
      captured.update = input
      return Effect.succeed({
        ...fakeTicketDetail,
        tags: input.tags ?? fakeTicketDetail.tags,
        assignees: input.assignees ?? fakeTicketDetail.assignees
      })
    },
    attachBranch: (_o: any, _u: any, _s: any, _id: any, input: any) => {
      captured.attach = input
      if (input.name === "missing/branch") {
        return Effect.fail(new BranchNotFound({ name: input.name }))
      }
      return Effect.succeed({ ...fakeTicketDetail, branch: input.name })
    }
  } as unknown as TicketsShape)

  const WriteCommentsStub = Layer.succeed(Comments, {
    create: (
      _o: any,
      _u: any,
      _s: any,
      ticketId: any,
      input: { body: string }
    ) => {
      captured.createComment = { ticketId, body: input.body }
      return Effect.succeed({
        id: "c_test1234",
        ticketId,
        projectSlug: "demo",
        author: {
          id: "u-1",
          username: null,
          name: "User",
          email: "u@example.com",
          image: null,
          createdAt: isoDate("2026-05-01T00:00:00.000Z"),
          activeOrgSlug: null,
          personalGithub: {
            connected: false
          },
          editorPreference: "github",
          personalEverhour: {
            connected: false,
            everhourUserId: null,
            name: null,
            email: null,
            lastVerifiedAt: null,
            lastCheckError: null
          }
        },
        body: input.body,
        createdAt: isoDate("2026-05-13T00:00:00.000Z"),
        editedAt: null
      })
    }
  } as unknown as CommentsShape)

  const WriteTestLayer = Layer.mergeAll(
    WriteTicketsStub,
    WriteCommentsStub,
    ProjectsStub,
    EmptyStub(Groups),
    EmptyStub(Tags),
    EmptyStub(Users),
    EmptyStub(BetterAuth),
    ProjectDocsStub,
    GroupDocsStub,
    TicketDocsStub,
    TicketIndexStub
  )

  const makeServer = (layer: Layer.Layer<any, never, never>) => {
    const runtime = ManagedRuntime.make(layer)
    const registered = new Map<string, (i: unknown) => Promise<any>>()
    const fakeServer = {
      registerTool: (name: string, _m: unknown, cb: any) => {
        registered.set(name, cb)
      }
    } as any
    registerAllTools(fakeServer, runtime as any, handlers as any)
    return { runtime, registered }
  }

  test("create_ticket forwards all fields and returns TicketDetail", async () => {
    captured.create = undefined
    const { runtime, registered } = makeServer(WriteTestLayer)
    const cb = registered.get("create_ticket")!
    const result = await withFakeUser(() =>
      cb({
        orgSlug: "acme",
        projectSlug: "demo",
        title: "rich title",
        status: "in_progress",
        priority: "high",
        type: "bug",
        tags: [],
        assignees: ["u-1"],
        body: "## Repro\n"
      })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.title).toBe("rich title")
    expect(payload.status).toBe("in_progress")
    expect(payload.priority).toBe("high")
    expect(payload.body).toBe("## Repro\n")
    expect(captured.create).toMatchObject({
      title: "rich title",
      status: "in_progress",
      assignees: ["u-1"]
    })

    await runtime.dispose()
  })

  test("update_ticket passes empty tags array through to clear list", async () => {
    captured.update = undefined
    const { runtime, registered } = makeServer(WriteTestLayer)
    const cb = registered.get("update_ticket")!
    const result = await withFakeUser(() =>
      cb({
        orgSlug: "acme",
        projectSlug: "demo",
        id: "T-1",
        tags: []
      })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.tags).toEqual([])
    expect(captured.update).toEqual({ tags: [] })

    await runtime.dispose()
  })

  test("create_comment returns the created comment", async () => {
    captured.createComment = undefined
    const { runtime, registered } = makeServer(WriteTestLayer)
    const cb = registered.get("create_comment")!
    const result = await withFakeUser(() =>
      cb({
        orgSlug: "acme",
        projectSlug: "demo",
        ticketId: "T-1",
        body: "Opened PR #42."
      })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.body).toBe("Opened PR #42.")
    expect(payload.ticketId).toBe("T-1")
    expect(captured.createComment).toEqual({
      ticketId: "T-1",
      body: "Opened PR #42."
    })

    await runtime.dispose()
  })

  test("attach_branch returns ticket with branch set on happy path", async () => {
    const { runtime, registered } = makeServer(WriteTestLayer)
    const cb = registered.get("attach_branch")!
    const result = await withFakeUser(() =>
      cb({
        orgSlug: "acme",
        projectSlug: "demo",
        id: "T-1",
        name: "feature/ok"
      })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload.branch).toBe("feature/ok")

    await runtime.dispose()
  })

  test("attach_branch surfaces BranchNotFound cleanly", async () => {
    const { runtime, registered } = makeServer(WriteTestLayer)
    const cb = registered.get("attach_branch")!
    const result = await withFakeUser(() =>
      cb({
        orgSlug: "acme",
        projectSlug: "demo",
        id: "T-1",
        name: "missing/branch"
      })
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text.toLowerCase()).toContain("branch not found")

    await runtime.dispose()
  })

  test("rebuild_ticket_index force rebuilds and returns the detected drift", async () => {
    const { runtime, registered } = makeServer(WriteTestLayer)
    const cb = registered.get("rebuild_ticket_index")!
    const result = await withFakeUser(() =>
      cb({ orgSlug: "acme", projectSlug: "demo" })
    )

    expect(result.isError).toBeUndefined()
    const payload = JSON.parse(result.content[0].text)
    expect(payload).toEqual({
      orgSlug: "acme",
      projectSlug: "demo",
      rebuilt: true,
      indexed: 3,
      skipped: 1,
      drift: { missing: ["T-2"], orphaned: ["T-9"], stale: ["T-1"] }
    })

    await runtime.dispose()
  })

  test("rebuild_ticket_index surfaces Forbidden when the caller lacks the role", async () => {
    const ForbiddenProjectsStub = Layer.succeed(Projects, {
      requireRole: (_o: any, _u: any, _s: any) => Effect.fail(new Forbidden())
    } as unknown as ProjectsShape)
    const layer = Layer.mergeAll(
      WriteTicketsStub,
      WriteCommentsStub,
      ForbiddenProjectsStub,
      EmptyStub(Groups),
      EmptyStub(Tags),
      EmptyStub(Users),
      EmptyStub(BetterAuth),
      ProjectDocsStub,
      GroupDocsStub,
      TicketDocsStub,
      TicketIndexStub
    )
    const { runtime, registered } = makeServer(layer)
    const cb = registered.get("rebuild_ticket_index")!
    const result = await withFakeUser(() =>
      cb({ orgSlug: "acme", projectSlug: "demo" })
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text.toLowerCase()).toContain("forbidden")

    await runtime.dispose()
  })

  test.skip("placeholder2", () => {})
})

describe("MCP dispatcher → add_tickets_to_group", () => {
  const decodeGroupId = Schema.decodeUnknownSync(GroupId)

  const makeGroupsStub = (behaviour: "ok" | "completed" = "ok") => {
    const captured: {
      orgSlug?: string
      userId?: string
      slug?: string
      groupId?: string
      ticketIds?: ReadonlyArray<string>
    } = {}
    const stub = Layer.succeed(Groups, {
      addTickets: (
        orgSlug: any,
        userId: any,
        slug: any,
        groupId: any,
        ticketIds: ReadonlyArray<string>
      ) => {
        captured.orgSlug = orgSlug
        captured.userId = userId
        captured.slug = slug
        captured.groupId = groupId
        captured.ticketIds = ticketIds
        if (behaviour === "completed") {
          return Effect.fail(new SprintCompletedImmutable())
        }
        return Effect.succeed({
          target: {
            id: decodeGroupId(groupId),
            name: "Sprint 1",
            kind: "sprint" as const,
            tickets: ticketIds.map((id) => decodeTicketId(id)),
            color: "#3366ff" as any,
            startsAt: null,
            endsAt: null,
            completedAt: null,
            createdBy: "u-1",
            createdAt: isoDate("2026-04-01T00:00:00.000Z"),
            updatedAt: isoDate("2026-05-13T00:00:00.000Z"),
            body: "# Sprint 1\n"
          },
          evicted: []
        })
      }
    } as any)
    return { stub, captured }
  }

  const makeLayer = (groupsLayer: Layer.Layer<Groups>) =>
    Layer.mergeAll(
      EmptyStub(Tickets),
      groupsLayer,
      EmptyStub(Comments),
      ProjectsStub,
      EmptyStub(Tags),
      EmptyStub(Users),
      EmptyStub(BetterAuth),
      ProjectDocsStub,
      GroupDocsStub,
      TicketDocsStub
    )

  const registerAndCall = (
    layer: Layer.Layer<any, never, never>,
    input: unknown
  ) => {
    const runtime = ManagedRuntime.make(layer)
    const registered = new Map<string, (i: unknown) => Promise<any>>()
    const fakeServer = {
      registerTool: (name: string, _m: unknown, cb: any) =>
        registered.set(name, cb)
    } as any
    registerAllTools(fakeServer, runtime as any, handlers as any)
    return {
      runtime,
      call: () =>
        withFakeUser(() => registered.get("add_tickets_to_group")!(input))
    }
  }

  test("delegates to groups.addTickets with the supplied path + ids", async () => {
    const { stub, captured } = makeGroupsStub("ok")
    const { runtime, call } = registerAndCall(makeLayer(stub), {
      orgSlug: "acme",
      projectSlug: "demo",
      groupId: "G-1",
      ticketIds: ["T-2", "T-2", "T-3"]
    })
    const result = await call()

    expect(result.isError).toBeUndefined()
    expect(captured.orgSlug).toBe("acme")
    expect(captured.slug).toBe("demo")
    expect(captured.groupId).toBe("G-1")
    expect(captured.userId).toBe("u-1")
    // Handler forwards the raw payload — the service is responsible for
    // dedup, merge, and write atomicity. Those are tested at the service
    // layer (see Layers/Groups-addTickets.test.ts).
    expect(captured.ticketIds).toEqual(["T-2", "T-2", "T-3"])

    await runtime.dispose()
  })

  test("surfaces SprintCompletedImmutable from the service", async () => {
    const { stub } = makeGroupsStub("completed")
    const { runtime, call } = registerAndCall(makeLayer(stub), {
      orgSlug: "acme",
      projectSlug: "demo",
      groupId: "G-1",
      ticketIds: ["T-2"]
    })
    const result = await call()

    expect(result.isError).toBe(true)
    expect(result.content[0].text.toLowerCase()).toContain("sprint")
    await runtime.dispose()
  })

  test.skip("placeholder", () => {})
})

describe("MCP dispatcher → sprint writes", () => {
  const decodeGroupId = Schema.decodeUnknownSync(GroupId)

  const baseGroup = (
    overrides: Partial<{ id: string; kind: string }> = {}
  ) => ({
    id: decodeGroupId(overrides.id ?? "G-1"),
    name: "Sprint 1",
    kind: (overrides.kind ?? "sprint") as any,
    tickets: [],
    color: "#3366ff" as any,
    startsAt: null,
    endsAt: null,
    completedAt: null,
    createdBy: "u-1",
    createdAt: isoDate("2026-04-01T00:00:00.000Z"),
    updatedAt: isoDate("2026-05-12T00:00:00.000Z"),
    body: "# Sprint 1\n"
  })

  const makeGroupsStub = (
    options: { kind?: string; completed?: boolean } = {}
  ) => {
    const captured: {
      createInput?: any
      updateInput?: any
      completeInput?: any
    } = {}
    const stub = Layer.succeed(Groups, {
      get: (_o: any, _u: any, _s: any, id: any) =>
        Effect.succeed(baseGroup({ id, kind: options.kind })),
      create: (_o: any, _u: any, _s: any, input: any) => {
        captured.createInput = input
        return Effect.succeed({
          id: decodeGroupId("G-9"),
          name: input.name,
          kind: input.kind ?? "sprint",
          tickets: input.tickets ?? [],
          color: input.color ?? ("#3366ff" as any),
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          completedAt: null,
          createdBy: "u-1",
          createdAt: isoDate("2026-05-13T00:00:00.000Z"),
          updatedAt: isoDate("2026-05-13T00:00:00.000Z")
        })
      },
      update: (_o: any, _u: any, _s: any, id: any, input: any) => {
        captured.updateInput = input
        return Effect.succeed({
          ...baseGroup({ id, kind: options.kind }),
          ...input
        })
      },
      complete: (_o: any, _u: any, _s: any, id: any, input: any) => {
        captured.completeInput = input
        if (options.completed) {
          return Effect.fail(new SprintCompletedImmutable())
        }
        return Effect.succeed({
          ...baseGroup({ id, kind: options.kind }),
          completedAt: isoDate("2026-05-13T00:00:00.000Z")
        })
      }
    } as any)
    return { stub, captured }
  }

  const makeLayer = (groupsLayer: Layer.Layer<Groups>) =>
    Layer.mergeAll(
      EmptyStub(Tickets),
      groupsLayer,
      EmptyStub(Comments),
      ProjectsStub,
      EmptyStub(Tags),
      EmptyStub(Users),
      EmptyStub(BetterAuth),
      ProjectDocsStub,
      GroupDocsStub,
      TicketDocsStub
    )

  const registerAndCall = (
    name: string,
    layer: Layer.Layer<any, never, never>,
    input: unknown
  ) => {
    const runtime = ManagedRuntime.make(layer)
    const registered = new Map<string, (i: unknown) => Promise<any>>()
    const fakeServer = {
      registerTool: (n: string, _m: unknown, cb: any) => registered.set(n, cb)
    } as any
    registerAllTools(fakeServer, runtime as any, handlers as any)
    return {
      runtime,
      call: () => withFakeUser(() => registered.get(name)!(input))
    }
  }

  test("create_sprint forces kind: 'sprint' regardless of agent input", async () => {
    const { stub, captured } = makeGroupsStub()
    const { runtime, call } = registerAndCall(
      "create_sprint",
      makeLayer(stub),
      {
        orgSlug: "acme",
        projectSlug: "demo",
        name: "Sprint 5"
      }
    )
    const result = await call()

    expect(result.isError).toBeUndefined()
    expect(captured.createInput?.kind).toBe("sprint")
    expect(captured.createInput?.name).toBe("Sprint 5")

    await runtime.dispose()
  })

  test("update_sprint applies the patch on a sprint-kind group", async () => {
    const { stub, captured } = makeGroupsStub({ kind: "sprint" })
    const { runtime, call } = registerAndCall(
      "update_sprint",
      makeLayer(stub),
      {
        orgSlug: "acme",
        projectSlug: "demo",
        id: "G-1",
        name: "Sprint 5 (renamed)",
        body: "## Goal\n- ship it"
      }
    )
    const result = await call()

    expect(result.isError).toBeUndefined()
    expect(captured.updateInput).toEqual({
      name: "Sprint 5 (renamed)",
      body: "## Goal\n- ship it"
    })

    await runtime.dispose()
  })

  test("update_sprint rejects non-sprint groups with Validation", async () => {
    const { stub, captured } = makeGroupsStub({ kind: "epic" })
    const { runtime, call } = registerAndCall(
      "update_sprint",
      makeLayer(stub),
      {
        orgSlug: "acme",
        projectSlug: "demo",
        id: "G-1",
        name: "should fail"
      }
    )
    const result = await call()

    expect(result.isError).toBe(true)
    expect(result.content[0].text.toLowerCase()).toContain("not_a_sprint")
    expect(captured.updateInput).toBeUndefined()

    await runtime.dispose()
  })

  test("complete_sprint forwards the destination", async () => {
    const { stub, captured } = makeGroupsStub({ kind: "sprint" })
    const { runtime, call } = registerAndCall(
      "complete_sprint",
      makeLayer(stub),
      {
        orgSlug: "acme",
        projectSlug: "demo",
        id: "G-1",
        destination: { kind: "backlog" }
      }
    )
    const result = await call()

    expect(result.isError).toBeUndefined()
    expect(captured.completeInput).toEqual({ destination: { kind: "backlog" } })

    await runtime.dispose()
  })

  test("complete_sprint rejects non-sprint groups with Validation", async () => {
    const { stub, captured } = makeGroupsStub({ kind: "milestone" })
    const { runtime, call } = registerAndCall(
      "complete_sprint",
      makeLayer(stub),
      {
        orgSlug: "acme",
        projectSlug: "demo",
        id: "G-1",
        destination: { kind: "backlog" }
      }
    )
    const result = await call()

    expect(result.isError).toBe(true)
    expect(result.content[0].text.toLowerCase()).toContain("not_a_sprint")
    expect(captured.completeInput).toBeUndefined()

    await runtime.dispose()
  })

  test("complete_sprint surfaces SprintCompletedImmutable", async () => {
    const { stub } = makeGroupsStub({ kind: "sprint", completed: true })
    const { runtime, call } = registerAndCall(
      "complete_sprint",
      makeLayer(stub),
      {
        orgSlug: "acme",
        projectSlug: "demo",
        id: "G-1",
        destination: { kind: "backlog" }
      }
    )
    const result = await call()

    expect(result.isError).toBe(true)
    // Specific surfaced text — confirms SprintCompletedImmutable's mapping
    // in errorMap, not just any error class.
    expect(result.content[0].text.toLowerCase()).toContain(
      "sprint is already completed"
    )
    await runtime.dispose()
  })

  test.skip("placeholder", () => {})
})

describe("MCP dispatcher → NotFound retained", () => {
  test("get_ticket_doc returns NotFound when caller can't see the project", async () => {
    const HiddenProjectsStub = Layer.succeed(Projects, {
      requireMember: (_o: any, _u: any, _s: any) => Effect.fail(new NotFound())
    } as unknown as ProjectsShape)

    const HiddenLayer = Layer.mergeAll(
      TicketsStub,
      HiddenProjectsStub,
      EmptyStub(Groups),
      EmptyStub(Tags),
      EmptyStub(Users),
      EmptyStub(BetterAuth),
      ProjectDocsStub,
      GroupDocsStub,
      TicketDocsStub
    )

    const runtime = ManagedRuntime.make(HiddenLayer)
    const registered = new Map<string, (i: unknown) => Promise<any>>()
    const fakeServer = {
      registerTool: (name: string, _m: unknown, cb: any) => {
        registered.set(name, cb)
      }
    } as any
    registerAllTools(fakeServer, runtime as any, handlers as any)

    const cb = registered.get("get_ticket_doc")
    const result = await withFakeUser(() =>
      cb!({ orgSlug: "acme", projectSlug: "demo", id: "T-1" })
    )

    expect(result.isError).toBe(true)
    expect(result.content[0].text.toLowerCase()).toContain("not found")

    await runtime.dispose()
  })
})

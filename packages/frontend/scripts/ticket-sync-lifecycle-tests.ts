import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as Predicate from "effect/Predicate"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
import { AppApi } from "@projectproject/shared"
import * as ApiClient from "../src/services/ApiClient"
import * as TicketSync from "../src/services/TicketSync"

const databaseName = "PROTOTYPE-ticket-sync-v2"
const params = { orgSlug: "measure", slug: "ten-thousand" }
const makeTicket = (id: string, title: string) => ({
  id,
  title,
  status: "todo",
  type: "chore",
  priority: "med",
  tags: [],
  assignees: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  gitState: { tag: "no_branch", baseBranch: "" },
  archivedAt: null,
  createdBy: "a",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z"
})
const ticket = makeTicket("T-1", "Original")
const secondTicket = makeTicket("T-2", "Second")
const snapshot = { checkpoint: { epoch: "test", revision: 1 }, items: [ticket] }
const twoTicketSnapshot = {
  checkpoint: { epoch: "test", revision: 1 },
  items: [ticket, secondTicket]
}
const delta = {
  checkpoint: { epoch: "test", revision: 2 },
  items: [{ ...ticket, title: "Updated" }],
  deleted: [],
  reset: false,
  hasMore: false
}
const twoTicketDelta = {
  checkpoint: { epoch: "test", revision: 2 },
  items: [
    { ...ticket, title: "Atomic first" },
    { ...secondTicket, title: "Atomic second" }
  ],
  deleted: [],
  reset: false,
  hasMore: false
}
const tombstoneDelta = {
  checkpoint: { epoch: "test", revision: 2 },
  items: [],
  deleted: [secondTicket.id],
  reset: false,
  hasMore: false
}
const gate = () => {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const check: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) throw new Error(message)
}
const removeDatabase = () =>
  new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName)
    request.addEventListener("success", () => resolve())
    request.addEventListener("error", () => reject(request.error))
    request.addEventListener("blocked", () =>
      reject(new Error("A service leaked its IndexedDB connection"))
    )
  })

const requestResult = <A>(request: IDBRequest<A>) =>
  new Promise<A>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result))
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed"))
    )
  })

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (effect: () => void) => {
      if (settled) return
      settled = true
      effect()
    }
    transaction.addEventListener("complete", () => finish(resolve))
    transaction.addEventListener("abort", () =>
      finish(() =>
        reject(transaction.error ?? new Error("IndexedDB transaction aborted"))
      )
    )
    transaction.addEventListener("error", () =>
      finish(() =>
        reject(transaction.error ?? new Error("IndexedDB transaction failed"))
      )
    )
  })

type Upgrade = (database: IDBDatabase, transaction: IDBTransaction) => void

const openDatabase = (version?: number, upgrade?: Upgrade) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request =
      version === undefined
        ? indexedDB.open(databaseName)
        : indexedDB.open(databaseName, version)
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
    }
    request.addEventListener("upgradeneeded", () => {
      if (!upgrade) return
      const transaction = request.transaction
      if (transaction === null) {
        fail(new Error("IndexedDB upgrade had no transaction"))
        return
      }
      upgrade(request.result, transaction)
    })
    request.addEventListener("success", () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      resolve(request.result)
    })
    request.addEventListener("error", () =>
      fail(request.error ?? new Error("IndexedDB open failed"))
    )
    request.addEventListener("blocked", () =>
      fail(new Error("IndexedDB open was blocked"))
    )
  })

const readStore = async (name: string): Promise<ReadonlyArray<unknown>> => {
  const database = await openDatabase()
  try {
    const transaction = database.transaction(name, "readonly")
    const done = transactionDone(transaction)
    const values = await requestResult(transaction.objectStore(name).getAll())
    await done
    return values
  } finally {
    database.close()
  }
}

const ticketRecordId = (projectId: string, ticketId: string) =>
  JSON.stringify([projectId, ticketId])

const accountRecordId = (owner: { server: string; userId: string }) =>
  JSON.stringify([owner.server, owner.userId])

const projectRecordId = (
  owner: { server: string; userId: string },
  projectParams: typeof params
) =>
  JSON.stringify([
    owner.server,
    owner.userId,
    projectParams.orgSlug,
    projectParams.slug
  ])

const ticketTitle = (rows: ReadonlyArray<unknown>, id: string) => {
  const row = rows.find((value) => Predicate.isObject(value) && value.id === id)
  if (!Predicate.isObject(row) || !Predicate.isObject(row.ticket))
    return undefined
  return typeof row.ticket.title === "string" ? row.ticket.title : undefined
}

const snapshotRevision = (rows: ReadonlyArray<unknown>) => {
  const row = rows[0]
  if (!Predicate.isObject(row) || !Predicate.isObject(row.checkpoint))
    return undefined
  return typeof row.checkpoint.revision === "number"
    ? row.checkpoint.revision
    : undefined
}

const createLegacySchema1 = async (owner: {
  server: string
  userId: string
  generation: number
}) => {
  const database = await openDatabase(1, (database) => {
    const auth = database.createObjectStore("auth", { keyPath: "id" })
    const project = database.createObjectStore("project", { keyPath: "id" })
    const snapshotStore = database.createObjectStore("snapshot", {
      keyPath: "id"
    })
    project.createIndex("byAccount", "accountId")
    snapshotStore.createIndex("byAccount", "accountId")
    auth.put({
      id: "global",
      generation: owner.generation,
      userId: owner.userId
    })
  })
  try {
    const transaction = database.transaction(
      ["auth", "project", "snapshot"],
      "readwrite"
    )
    const done = transactionDone(transaction)
    const id = projectRecordId(owner, params)
    const accountId = accountRecordId(owner)
    transaction.objectStore("project").put({ id, accountId, generation: 0 })
    transaction.objectStore("snapshot").put({
      id,
      accountId,
      generation: 0,
      checkpoint: { epoch: "legacy", revision: 8 },
      items: [ticket]
    })
    await done
  } finally {
    database.close()
  }
}

type IdManager = {
  readonly onPut?: (store: IDBObjectStore, value: object) => void
  readonly onGet?: (store: IDBObjectStore) => void
  readonly onGetAll?: (store: IDBObjectStore) => void
  readonly onIndexGetAll?: (index: IDBIndex) => void
}

const instrumentIndexedDb = (manager: IdManager) => {
  const stores = IDBObjectStore.prototype
  const indexes = IDBIndex.prototype
  const putDescriptor = Object.getOwnPropertyDescriptor(stores, "put")
  const getDescriptor = Object.getOwnPropertyDescriptor(stores, "get")
  const getAllDescriptor = Object.getOwnPropertyDescriptor(stores, "getAll")
  const indexGetAllDescriptor = Object.getOwnPropertyDescriptor(
    indexes,
    "getAll"
  )
  if (
    !putDescriptor ||
    !getDescriptor ||
    !getAllDescriptor ||
    !indexGetAllDescriptor
  )
    throw new Error("IndexedDB methods cannot be instrumented")
  // oxlint-disable-next-line typescript/unbound-method
  const { put, get, getAll } = stores
  // oxlint-disable-next-line typescript/unbound-method
  const { getAll: indexGetAll } = indexes

  stores.put = function (
    this: IDBObjectStore,
    value: object,
    key?: IDBValidKey
  ) {
    const request = put.call(this, value, key)
    manager.onPut?.(this, value)
    return request
  }
  stores.get = function (
    this: IDBObjectStore,
    query: IDBValidKey | IDBKeyRange
  ) {
    const request = get.call(this, query)
    manager.onGet?.(this)
    return request
  }
  stores.getAll = function (
    this: IDBObjectStore,
    ...args: Parameters<typeof getAll>
  ) {
    const request = getAll.apply(this, args)
    manager.onGetAll?.(this)
    return request
  }
  indexes.getAll = function (
    this: IDBIndex,
    ...args: Parameters<typeof indexGetAll>
  ) {
    const request = indexGetAll.apply(this, args)
    manager.onIndexGetAll?.(this)
    return request
  }

  let restored = false
  return () => {
    if (restored) return
    restored = true
    Object.defineProperty(stores, "put", putDescriptor)
    Object.defineProperty(stores, "get", getDescriptor)
    Object.defineProperty(stores, "getAll", getAllDescriptor)
    Object.defineProperty(indexes, "getAll", indexGetAllDescriptor)
  }
}

function clients() {
  const runtimes: Array<{ dispose: () => Promise<void> }> = []
  function create(fetcher: typeof fetch) {
    const runtime = ManagedRuntime.make(
      TicketSync.layer.pipe(
        Layer.provideMerge(
          Layer.effect(
            ApiClient.ApiClient,
            HttpApiClient.make(AppApi, { baseUrl: "/api" })
          ).pipe(Layer.provide(FetchHttpClient.layer))
        ),
        Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetcher))
      )
    )
    runtimes.push(runtime)
    return runtime
  }
  return {
    create,
    close: () => Promise.all(runtimes.map((runtime) => runtime.dispose()))
  }
}

const owner = (runtime: ReturnType<ReturnType<typeof clients>["create"]>) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const sync = yield* TicketSync.TicketSync
      return yield* sync.activate("a", yield* sync.capture)
    })
  )

export async function runTicketSyncLifecycleTests() {
  if (location.hostname !== "localhost" || location.port !== "4195")
    throw new Error("Use isolated test origin localhost:4195")
  const results: Array<{ name: string; passed: boolean; error?: string }> = []
  const test = async (
    name: string,
    run: (client: ReturnType<typeof clients>) => Promise<void>
  ) => {
    await removeDatabase()
    const context = clients()
    try {
      await Effect.runPromise(
        Effect.tryPromise(() => run(context)).pipe(Effect.timeout("10 seconds"))
      )
      results.push({ name, passed: true })
    } catch (error) {
      results.push({
        name,
        passed: false,
        error:
          String(error) +
          (error instanceof Error ? `: ${String(error.cause)}` : "")
      })
    } finally {
      await context.close()
    }
    await removeDatabase()
  }
  const respond: typeof fetch = async (input) =>
    Response.json(
      (input instanceof Request ? input.url : input.toString()).includes(
        "sync-delta"
      )
        ? delta
        : snapshot
    )
  for (const kind of ["bootstrap", "delta"] as const) {
    await test(`delayed ${kind} cannot revive a revoked account`, async ({
      create
    }) => {
      const started = gate(),
        release = gate()
      const runtime = create(async (input, init) => {
        const isDelta = (
          input instanceof Request ? input.url : input.toString()
        ).includes("sync-delta")
        if ((kind === "delta") === isDelta) {
          started.release()
          await release.promise
        }
        return respond(input, init)
      })
      const sync = await runtime.runPromise(TicketSync.TicketSync)
      const account = await owner(runtime)
      if (kind === "delta") await runtime.runPromise(sync.read(account, params))
      const pending = runtime.runPromiseExit(
        kind === "delta"
          ? sync.poll(account, params).pipe(Effect.asVoid)
          : sync.read(account, params).pipe(Effect.asVoid)
      )
      await started.promise
      await runtime.runPromise(
        sync.clear({ owner: account, generation: account.generation })
      )
      release.release()
      check(Exit.isFailure(await pending), "Late response was accepted")
      check(
        (await runtime.runPromise(sync.capture)).owner === null,
        "Revoked auth was restored"
      )
      check(
        (await readStore("snapshot")).length === 0,
        "Late response repersisted tickets"
      )
    })
  }
  await test("bootstrap renders before persistence and catch-up preserves newer edits", async ({
    create
  }) => {
    const runtime = create(respond)
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    let checkpointWrites = 0
    const restore = instrumentIndexedDb({
      onPut: (store) => {
        if (store.name === "snapshot") checkpointWrites++
      }
    })
    try {
      const reads = await Promise.all([
        runtime.runPromise(sync.read(account, params)),
        runtime.runPromise(sync.read(account, params)),
        runtime.runPromise(sync.read(account, params))
      ])
      const items = reads[0]
      check(
        reads.every((value) => value === items),
        "Concurrent reads did not share the bootstrap"
      )
      check(
        items[0]?.title === "Original",
        "Bootstrap did not return its tickets"
      )
      check(checkpointWrites === 0, "Read waited for the checkpoint write")
      await runtime.runPromise(sync.poll(account, params))
      check(
        snapshotRevision(await readStore("snapshot")) === 2,
        "Catch-up lost its checkpoint"
      )
      check(
        (await runtime.runPromise(sync.read(account, params)))[0]?.title ===
          "Updated",
        "Bootstrap overwrote the newer delta"
      )
    } finally {
      restore()
    }
  })
  await test("failed background bootstrap leaves no partial replica and retries", async ({
    create
  }) => {
    const runtime = create(respond)
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    const restore = instrumentIndexedDb({
      onPut: (store) => {
        if (store.name === "snapshot") store.transaction.abort()
      }
    })
    try {
      check(
        (await runtime.runPromise(sync.read(account, params)))[0]?.title ===
          "Original",
        "Persistence failure prevented first display"
      )
      check(
        (await readStore("snapshot")).length === 0,
        "Failed bootstrap persisted its checkpoint"
      )
      check(
        (await readStore("ticket")).length === 0,
        "Failed bootstrap left ticket rows"
      )
    } finally {
      restore()
    }
    await runtime.runPromise(sync.poll(account, params))
    check(
      snapshotRevision(await readStore("snapshot")) === 1,
      "Background retry did not rebuild the replica"
    )
  })
  await test("closing the scope during bootstrap cancels persistence", async ({
    create
  }) => {
    const first = create(respond)
    const sync = await first.runPromise(TicketSync.TicketSync)
    await first.runPromise(sync.read(await owner(first), params))
    await first.dispose()
    check(
      (await readStore("snapshot")).length === 0,
      "Interrupted bootstrap committed its checkpoint"
    )
    check(
      (await readStore("ticket")).length === 0,
      "Interrupted bootstrap left ticket rows"
    )
    const next = create(respond)
    const nextSync = await next.runPromise(TicketSync.TicketSync)
    await next.runPromise(nextSync.read(await owner(next), params))
    check(
      snapshotRevision(await readStore("snapshot")) === 1,
      "Fresh runtime did not recover after interrupted bootstrap"
    )
  })
  await test("revocation after first display removes the pending bootstrap", async ({
    create
  }) => {
    const runtime = create(respond)
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    await runtime.runPromise(sync.read(account, params))
    await runtime.runPromise(
      sync.clear({ generation: account.generation, owner: account })
    )
    check(
      (await readStore("snapshot")).length === 0,
      "Revoked bootstrap restored a checkpoint"
    )
    check(
      (await readStore("ticket")).length === 0,
      "Revoked bootstrap restored tickets"
    )
    check(
      Exit.isFailure(await runtime.runPromiseExit(sync.read(account, params))),
      "Revoked owner could read pending tickets"
    )
  })
  await test("reset cancels a pending bootstrap and releases the replica lock", async ({
    create
  }) => {
    const started = gate()
    let aborted = false
    let blocked = true
    const runtime = create(async (input, init) => {
      if (!blocked) return respond(input, init)
      started.release()
      const signal =
        init?.signal ?? (input instanceof Request ? input.signal : undefined)
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true }
        )
      })
    })
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    const pending = runtime.runPromiseExit(sync.read(account, params))
    await started.promise
    await runtime.runPromise(sync.reset)
    check(Exit.isFailure(await pending), "Reset left a pending read unresolved")
    check(aborted, "Reset did not cancel the network request")
    blocked = false
    await runtime.runPromise(
      sync.clear({ generation: account.generation, owner: account })
    )
    const nextOwner = await owner(runtime)
    check(
      (await runtime.runPromise(sync.read(nextOwner, params)))[0]?.title ===
        "Original",
      "A new session reused the cancelled bootstrap"
    )
    await readStore("snapshot")
  })
  await test("stale authentication cannot reactivate after revocation", async ({
    create
  }) => {
    const runtime = create(respond),
      sync = await runtime.runPromise(TicketSync.TicketSync)
    await owner(runtime)
    const captured = await runtime.runPromise(sync.capture)
    await runtime.runPromise(sync.clear(captured))
    check(
      Exit.isFailure(
        await runtime.runPromiseExit(sync.activate("a", captured))
      ),
      "Stale identity accepted"
    )
  })
  await test("service scopes isolate memory, persist hydration, and close connections", async ({
    create
  }) => {
    const first = create(respond),
      second = create(respond)
    const a = await first.runPromise(TicketSync.TicketSync),
      b = await second.runPromise(TicketSync.TicketSync)
    const account = await owner(first)
    await first.runPromise(a.read(account, params))
    check(
      Exit.isFailure(await second.runPromiseExit(b.read(account, params))),
      "Another scope inherited active memory"
    )
    await readStore("snapshot")
    await first.dispose()
    let fetches = 0
    const next = create(async (input, init) => {
      fetches++
      return respond(input, init)
    })
    const c = await next.runPromise(TicketSync.TicketSync),
      nextOwner = await owner(next)
    check(
      (await next.runPromise(c.read(nextOwner, params))).length === 1,
      "Persisted snapshot missing"
    )
    check(fetches === 0, "Hydration fetched a new snapshot")
    check(
      Exit.isFailure(await Effect.runPromiseExit(a.capture)),
      "Disposed service remained usable"
    )
  })
  await test("checkpoint-only polling skips bootstrap and writes one ticket row", async ({
    create
  }) => {
    let snapshotRequests: number = 0
    let deltaRequests: number = 0
    const fetcher: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes("sync-delta")) {
        deltaRequests++
        return Response.json(delta)
      }
      snapshotRequests++
      return Response.json(twoTicketSnapshot)
    }

    const emptyRuntime = create(fetcher)
    const emptySync = await emptyRuntime.runPromise(TicketSync.TicketSync)
    const emptyOwner = await owner(emptyRuntime)
    let emptyTicketGets = 0
    let emptyTicketGetAlls = 0
    let emptyTicketIndexGetAlls = 0
    const restoreEmpty = instrumentIndexedDb({
      onGet: (store) => {
        if (store.name === "ticket") emptyTicketGets++
      },
      onGetAll: (store) => {
        if (store.name === "ticket") emptyTicketGetAlls++
      },
      onIndexGetAll: (index) => {
        if (index.objectStore.name === "ticket") emptyTicketIndexGetAlls++
      }
    })
    try {
      check(
        !(await emptyRuntime.runPromise(
          emptySync.poll(emptyOwner, params, { bootstrap: false })
        )),
        "Empty checkpoint poll should skip bootstrap"
      )
    } finally {
      restoreEmpty()
    }
    check(
      [snapshotRequests, deltaRequests].every((count) => count === 0),
      "Empty checkpoint poll requested network data"
    )
    check(
      emptyTicketGets + emptyTicketGetAlls + emptyTicketIndexGetAlls === 0,
      "Empty checkpoint poll read ticket rows"
    )
    await emptyRuntime.dispose()

    const firstRuntime = create(fetcher)
    const firstSync = await firstRuntime.runPromise(TicketSync.TicketSync)
    const firstOwner = await owner(firstRuntime)
    check(
      (await firstRuntime.runPromise(firstSync.read(firstOwner, params)))
        .length === 2,
      "Initial snapshot did not persist both tickets"
    )
    await readStore("snapshot")
    await firstRuntime.dispose()

    const runtime = create(fetcher)
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    const projectId = projectRecordId(account, params)
    const ticketPuts: Array<string> = []
    let ticketGets = 0
    let ticketGetAlls = 0
    let ticketIndexGetAlls = 0
    let snapshotGets = 0
    const restore = instrumentIndexedDb({
      onPut: (store, value) => {
        if (store.name !== "ticket" || !Predicate.isObject(value)) return
        if (typeof value.id === "string") ticketPuts.push(value.id)
      },
      onGet: (store) => {
        if (store.name === "ticket") ticketGets++
        if (store.name === "snapshot") snapshotGets++
      },
      onGetAll: (store) => {
        if (store.name === "ticket") ticketGetAlls++
        if (store.name === "snapshot") snapshotGets++
      },
      onIndexGetAll: (index) => {
        if (index.objectStore.name === "ticket") ticketIndexGetAlls++
      }
    })
    let changed = false
    try {
      changed = await runtime.runPromise(
        sync.poll(account, params, { bootstrap: false })
      )
    } finally {
      restore()
    }
    check(changed, "Persisted checkpoint delta was not reported")
    check(snapshotRequests === 1, "Fresh poll fetched a bootstrap snapshot")
    check(deltaRequests === 1, "Fresh poll did not request one delta")
    check(
      ticketPuts.length === 1 &&
        ticketPuts[0] === ticketRecordId(projectId, ticket.id),
      "Single-ticket delta rewrote more than its changed row"
    )
    check(
      ticketGets + ticketGetAlls + ticketIndexGetAlls === 0,
      "Checkpoint-only poll hydrated ticket rows"
    )
    check(
      snapshotGets > 0,
      "Checkpoint-only poll did not read checkpoint metadata"
    )
    check(
      snapshotRevision(await readStore("snapshot")) === 2,
      "Delta checkpoint was not persisted"
    )
    const persistedTickets = await readStore("ticket")
    check(
      persistedTickets.length === 2 &&
        ticketTitle(persistedTickets, ticketRecordId(projectId, ticket.id)) ===
          "Updated" &&
        ticketTitle(
          persistedTickets,
          ticketRecordId(projectId, secondTicket.id)
        ) === "Second",
      "Single-ticket delta changed the wrong ticket rows"
    )
    const hydrated = await runtime.runPromise(sync.read(account, params))
    check(
      hydrated.length === 2 &&
        hydrated.some(
          (value) => value.id === ticket.id && value.title === "Updated"
        ) &&
        hydrated.some(
          (value) => value.id === secondTicket.id && value.title === "Second"
        ),
      "Subsequent read did not hydrate all persisted tickets"
    )
  })
  await test("checkpoint-only polling rejects invalid delta checkpoints", async ({
    create
  }) => {
    const first = create(respond)
    const initialSync = await first.runPromise(TicketSync.TicketSync)
    await first.runPromise(initialSync.read(await owner(first), params))
    await readStore("snapshot")
    await first.dispose()
    for (const checkpoint of [
      { epoch: "unexpected", revision: 2 },
      { epoch: "test", revision: 0 }
    ]) {
      const runtime = create(async () =>
        Response.json({ ...delta, checkpoint })
      )
      const sync = await runtime.runPromise(TicketSync.TicketSync)
      const account = await owner(runtime)
      check(
        Exit.isFailure(
          await runtime.runPromiseExit(sync.poll(account, params))
        ),
        "Invalid checkpoint was accepted without a hydrated snapshot"
      )
      check(
        snapshotRevision(await readStore("snapshot")) === 1,
        "Invalid delta advanced the checkpoint"
      )
      check(
        (await runtime.runPromise(sync.read(account, params)))[0]?.title ===
          "Original",
        "Invalid delta changed a ticket"
      )
      await runtime.dispose()
    }
  })
  await test("ticket delta commits are atomic with its checkpoint", async ({
    create
  }) => {
    const fetcher: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      return Response.json(
        url.includes("sync-delta") ? twoTicketDelta : twoTicketSnapshot
      )
    }
    const runtime = create(fetcher)
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    await runtime.runPromise(sync.read(account, params))
    const projectId = projectRecordId(account, params)
    const beforeTickets = await readStore("ticket")
    const beforeSnapshot = await readStore("snapshot")
    let ticketPuts = 0
    const restore = instrumentIndexedDb({
      onPut: (store) => {
        if (store.name !== "ticket") return
        ticketPuts++
        if (ticketPuts === 2) store.transaction.abort()
      }
    })
    let failure: Exit.Exit<unknown, unknown>
    try {
      failure = await runtime.runPromiseExit(sync.poll(account, params))
    } finally {
      restore()
    }
    check(Exit.isFailure(failure), "Injected ticket write failure was ignored")
    check(
      ticketPuts === 2,
      "Atomicity probe did not fail between ticket writes"
    )
    const afterTickets = await readStore("ticket")
    const afterSnapshot = await readStore("snapshot")
    check(
      ticketTitle(afterTickets, ticketRecordId(projectId, ticket.id)) ===
        ticketTitle(beforeTickets, ticketRecordId(projectId, ticket.id)) &&
        ticketTitle(
          afterTickets,
          ticketRecordId(projectId, secondTicket.id)
        ) ===
          ticketTitle(
            beforeTickets,
            ticketRecordId(projectId, secondTicket.id)
          ),
      "Atomic failure left a partially updated ticket set"
    )
    check(
      snapshotRevision(afterSnapshot) === snapshotRevision(beforeSnapshot),
      "Atomic failure advanced the checkpoint"
    )
  })
  await test("independent runtimes adopt a persisted newer checkpoint", async ({
    create
  }) => {
    let snapshots: number = 0
    const revisions: Array<number> = []
    const fetcher: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (!url.includes("sync-delta")) {
        snapshots++
        return Response.json(twoTicketSnapshot)
      }
      const revision = Number(
        new URL(url, location.origin).searchParams.get("revision")
      )
      revisions.push(revision)
      return Response.json(delta)
    }
    const first = create(fetcher)
    const second = create(fetcher)
    const firstSync = await first.runPromise(TicketSync.TicketSync)
    const secondSync = await second.runPromise(TicketSync.TicketSync)
    const firstOwner = await owner(first)
    const secondOwner = await owner(second)
    await first.runPromise(firstSync.read(firstOwner, params))
    await second.runPromise(secondSync.read(secondOwner, params))
    await first.runPromise(firstSync.poll(firstOwner, params))
    const adopted = await second.runPromise(
      secondSync.read(secondOwner, params)
    )
    check(
      adopted.some(
        (value) => value.id === ticket.id && value.title === "Updated"
      ),
      "Stale runtime did not adopt the persisted ticket update"
    )
    check(
      adopted.some(
        (value) => value.id === secondTicket.id && value.title === "Second"
      ),
      "Stale runtime lost an unchanged persisted ticket"
    )
    check(snapshots === 1, "Stale runtime fetched a new snapshot")
    check(
      revisions.length === 1 && revisions[0] === 1,
      "Unexpected stale checkpoint request"
    )
  })
  await test("tombstones survive hydration in a fresh runtime", async ({
    create
  }) => {
    const firstFetcher: typeof fetch = async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      return Response.json(
        url.includes("sync-delta") ? tombstoneDelta : twoTicketSnapshot
      )
    }
    const first = create(firstFetcher)
    const firstSync = await first.runPromise(TicketSync.TicketSync)
    const firstOwner = await owner(first)
    await first.runPromise(firstSync.read(firstOwner, params))
    await first.runPromise(firstSync.poll(firstOwner, params))
    const projectId = projectRecordId(firstOwner, params)
    const rows = await readStore("ticket")
    check(
      rows.length === 1 &&
        ticketTitle(rows, ticketRecordId(projectId, ticket.id)) ===
          "Original" &&
        ticketTitle(rows, ticketRecordId(projectId, secondTicket.id)) ===
          undefined,
      "Tombstone did not remove its ticket row"
    )
    await readStore("snapshot")
    await first.dispose()
    let fetches = 0
    const second = create(async () => {
      fetches++
      throw new Error("Hydration fetched from the API")
    })
    const secondSync = await second.runPromise(TicketSync.TicketSync)
    const secondOwner = await owner(second)
    const hydrated = await second.runPromise(
      secondSync.read(secondOwner, params)
    )
    check(
      hydrated.length === 1 && hydrated[0]?.id === ticket.id,
      "Tombstone hydration restored a deleted ticket"
    )
    check(fetches === 0, "Tombstone hydration fetched from the API")
  })
  await test("schema v1 migration reboots snapshots and preserves auth", async ({
    create
  }) => {
    const legacyOwner = {
      server: location.origin,
      userId: "a",
      generation: 7
    }
    await createLegacySchema1(legacyOwner)
    let snapshots = 0
    const runtime = create(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (url.includes("sync-delta"))
        throw new Error("Legacy cache should rebootstrap")
      snapshots++
      return Response.json(snapshot)
    })
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    check(
      account.generation === legacyOwner.generation,
      "Schema migration changed auth generation"
    )
    check(
      account.userId === legacyOwner.userId,
      "Schema migration changed authenticated user"
    )
    check(
      (await runtime.runPromise(sync.read(account, params)))[0]?.title ===
        "Original",
      "Schema migration did not rebootstrap the snapshot"
    )
    check(
      snapshots === 1,
      "Schema migration did not force one snapshot request"
    )
    const database = await openDatabase()
    try {
      check(database.version === 2, "Schema migration did not reach version 2")
      check(
        database.objectStoreNames.contains("ticket"),
        "Schema migration did not create ticket store"
      )
      const names = Array.from(database.objectStoreNames)
      check(
        names.length === 4 &&
          ["auth", "project", "snapshot", "ticket"].every((name) =>
            names.includes(name)
          ),
        "Schema migration left an unexpected store"
      )
    } finally {
      database.close()
    }
    const migratedSnapshot = await readStore("snapshot")
    check(
      snapshotRevision(migratedSnapshot) === 1,
      "Rebootstrap checkpoint was not persisted"
    )
    const migratedTickets = await readStore("ticket")
    check(
      migratedTickets.length === 1,
      "Rebootstrap ticket row was not persisted"
    )
  })
  await test("transport failure preserves local tickets", async ({
    create
  }) => {
    let offline = false
    const runtime = create(async (input, init) => {
      if (offline) throw new TypeError("offline")
      return respond(input, init)
    })
    const sync = await runtime.runPromise(TicketSync.TicketSync),
      account = await owner(runtime)
    await runtime.runPromise(sync.read(account, params))
    offline = true
    check(
      Exit.isFailure(await runtime.runPromiseExit(sync.poll(account, params))),
      "Expected transport failure"
    )
    check(
      (await runtime.runPromise(sync.read(account, params)))[0]?.title ===
        "Original",
      "Transport failure lost cached data"
    )
  })
  await test("one poll drains all delta pages", async ({ create }) => {
    let pages = 0
    const runtime = create(async (input) => {
      const url = input instanceof Request ? input.url : input.toString()
      if (!url.includes("sync-delta")) return Response.json(snapshot)
      pages++
      return Response.json({
        ...delta,
        checkpoint: { epoch: "test", revision: pages + 1 },
        items: [{ ...ticket, title: `Page ${pages}` }],
        hasMore: pages < 3
      })
    })
    const sync = await runtime.runPromise(TicketSync.TicketSync)
    const account = await owner(runtime)
    await runtime.runPromise(sync.read(account, params))
    check(
      await runtime.runPromise(sync.poll(account, params)),
      "Expected changes"
    )
    check(pages === 3, "Poll stopped before the last page")
    check(
      (await runtime.runPromise(sync.read(account, params)))[0]?.title ===
        "Page 3",
      "Last delta page was not committed"
    )
  })
  return results
}
Object.assign(window, { runTicketSyncLifecycleTests })

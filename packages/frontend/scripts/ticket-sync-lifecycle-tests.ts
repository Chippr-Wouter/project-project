import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import * as ApiClient from "../src/services/ApiClient"
import * as TicketSync from "../src/services/TicketSync"

const params = { orgSlug: "measure", slug: "ten-thousand" }
const ticket = {
  id: "T-1",
  title: "Original",
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
}
const snapshot = { checkpoint: { epoch: "test", revision: 1 }, items: [ticket] }
const delta = {
  checkpoint: { epoch: "test", revision: 2 },
  items: [{ ...ticket, title: "Updated" }],
  deleted: [],
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
    const request = indexedDB.deleteDatabase("PROTOTYPE-ticket-sync-v2")
    request.addEventListener("success", () => resolve())
    request.addEventListener("error", () => reject(request.error))
    request.addEventListener("blocked", () =>
      reject(new Error("A service leaked its IndexedDB connection"))
    )
  })

function clients() {
  const runtimes: Array<{ dispose: () => Promise<void> }> = []
  function create(fetcher: typeof fetch) {
    const runtime = ManagedRuntime.make(
      TicketSync.layer.pipe(
        Layer.provideMerge(ApiClient.ApiClient.Default),
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
      results.push({ name, passed: false, error: String(error) })
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
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open("PROTOTYPE-ticket-sync-v2")
        request.addEventListener("success", () => resolve(request.result))
      })
      const count = await new Promise<number>((resolve) => {
        const request = db
          .transaction("snapshot")
          .objectStore("snapshot")
          .count()
        request.addEventListener("success", () => resolve(request.result))
      })
      db.close()
      check(count === 0, "Late response repersisted tickets")
    })
  }
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
  return results
}
Object.assign(window, { runTicketSyncLifecycleTests })

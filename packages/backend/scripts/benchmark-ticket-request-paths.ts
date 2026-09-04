import { mkdir, rm, writeFile } from "node:fs/promises"
import { arch, cpus, platform } from "node:os"
import { join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { BunContext } from "@effect/platform-bun"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import matter from "gray-matter"
import pg from "pg"
import { ProjectDetail, ProjectKey } from "@projectproject/shared"
import { Attachments, type AttachmentsShape } from "../src/Services/Attachments"
import { Comments, type CommentsShape } from "../src/Services/Comments"
import { GitHub, type GitHubShape } from "../src/Services/GitHub"
import { Groups, type GroupsShape } from "../src/Services/Groups"
import { Projects, type ProjectsShape } from "../src/Services/Projects"
import { Tickets } from "../src/Services/Tickets"
import { DbLive, PgLive } from "../src/Layers/Db"
import { MarkdownLive } from "../src/Layers/Markdown"
import { TicketDocsLive } from "../src/Layers/TicketDocs"
import { TicketIndexLive } from "../src/Layers/TicketIndex"
import { TicketsLive } from "../src/Layers/Tickets"

const { Client } = pg
const decodeProjectKey = Schema.decodeUnknownSync(ProjectKey)
const decodeProjectDetail = Schema.decodeUnknownSync(ProjectDetail)
const orgSlug = "benchmark"
const userId = "benchmark-user"

const benchmarkProject = decodeProjectDetail({
  org: orgSlug,
  slug: "benchmark",
  key: "T",
  name: "Benchmark",
  icon: "B",
  color: "#000000",
  createdBy: userId,
  createdAt: "2026-01-01T00:00:00.000Z",
  github: null,
  setup: {
    workflowReviewedAt: null,
    invitePeopleDismissedAt: null,
    connectGithubDismissedAt: null
  },
  body: "",
  members: [],
  pendingMembers: []
})

interface Options {
  readonly ticketCount: number
  readonly sampleCount: number
  readonly concurrencies: ReadonlyArray<number>
  readonly projectsRoot: string
  readonly variant: string
  readonly round: number
  readonly json: boolean
}

interface Sample {
  readonly durationMs: number
  readonly failure: string | null
}

interface BenchmarkResult {
  readonly operation: string
  readonly concurrency: number
  readonly samples: number
  readonly failures: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly throughputPerSecond: number
  readonly wallTimeMs: number
  readonly firstFailure: string | null
}

const argumentValue = (name: string): string | undefined => {
  const prefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  if (index < 0 || index + 1 >= process.argv.length) return undefined
  const value = process.argv[index + 1]
  return value.startsWith("-") ? undefined : value
}

const positiveInteger = (
  value: string | undefined,
  fallback: number,
  name: string
) => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

const parseConcurrencies = (
  value: string | undefined
): ReadonlyArray<number> => {
  if (value === undefined) return [1, 32]
  const values = value
    .split(",")
    .map((part) => positiveInteger(part.trim(), 1, "--concurrency"))
  if (values.length === 0) throw new Error("--concurrency cannot be empty")
  return [...new Set(values)]
}

const parseOptions = (): Options => ({
  ticketCount: positiveInteger(argumentValue("--tickets"), 10_000, "--tickets"),
  sampleCount: positiveInteger(argumentValue("--samples"), 200, "--samples"),
  concurrencies: parseConcurrencies(argumentValue("--concurrency")),
  projectsRoot: resolve(process.env.PROJECTS_DIR ?? "/data"),
  variant: argumentValue("--variant") ?? "working-tree",
  round: positiveInteger(argumentValue("--round"), 1, "--round"),
  json: process.argv.includes("--json")
})

const bodySizeKiB = (index: number): number => {
  if (index % 20 === 0) return 64
  if (index % 4 === 0) return 16
  return 4
}

const makeBody = (index: number): string => {
  const targetLength = bodySizeKiB(index) * 1_024
  const heading = `# Benchmark ticket ${index + 1}\n\n`
  const paragraph =
    "A representative markdown paragraph with enough text to exercise ticket document reads and writes.\n\n"
  const repeats = Math.ceil((targetLength - heading.length) / paragraph.length)
  return `${heading}${paragraph.repeat(Math.max(0, repeats))}`.slice(
    0,
    targetLength
  )
}

const ticketContent = (index: number): string => {
  const timestamp = "2026-01-01T00:00:00.000Z"
  return matter.stringify(makeBody(index), {
    id: `T-${index + 1}`,
    title: `Benchmark ticket ${index + 1}`,
    status: "todo",
    type: "other",
    priority: "med",
    tags: [],
    branch: null,
    pr: null,
    prState: null,
    lastTransitionedPr: null,
    assignees: [],
    archivedAt: null,
    createdBy: userId,
    createdAt: timestamp,
    updatedAt: timestamp
  })
}

const percentile = (sorted: ReadonlyArray<number>, value: number): number => {
  if (sorted.length === 0) return 0
  const index = Math.max(0, Math.ceil(sorted.length * value) - 1)
  return sorted[Math.min(index, sorted.length - 1)]
}

const round = (value: number): number => Math.round(value * 100) / 100

const timed = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<Sample> =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeNanos
    const exit = yield* Effect.exit(effect)
    const finishedAt = yield* Clock.currentTimeNanos
    return {
      durationMs: Number(finishedAt - startedAt) / 1_000_000,
      failure: Exit.isSuccess(exit) ? null : Cause.pretty(exit.cause)
    }
  })

const runWorkload = <A, E>(
  operation: string,
  concurrency: number,
  sampleCount: number,
  effectFor: (sample: number) => Effect.Effect<A, E>
): Effect.Effect<BenchmarkResult> =>
  Effect.gen(function* () {
    const warmupCount = Math.min(10, sampleCount)
    yield* Effect.forEach(
      Array.from({ length: warmupCount }, (_, index) => index),
      (sample) => timed(effectFor(sample)),
      { concurrency, discard: true }
    )

    const startedAt = yield* Clock.currentTimeNanos
    const samples = yield* Effect.forEach(
      Array.from({ length: sampleCount }, (_, index) => index + warmupCount),
      (sample) => timed(effectFor(sample)),
      { concurrency }
    )
    const finishedAt = yield* Clock.currentTimeNanos
    const wallTimeMs = Number(finishedAt - startedAt) / 1_000_000
    const successful = samples
      .filter((sample) => sample.failure === null)
      .map((sample) => sample.durationMs)
      .toSorted((left, right) => left - right)
    const failures = samples.filter((sample) => sample.failure !== null)

    return {
      operation,
      concurrency,
      samples: sampleCount,
      failures: failures.length,
      p50Ms: round(percentile(successful, 0.5)),
      p95Ms: round(percentile(successful, 0.95)),
      p99Ms: round(percentile(successful, 0.99)),
      throughputPerSecond: round(successful.length / (wallTimeMs / 1_000)),
      wallTimeMs: round(wallTimeMs),
      firstFailure: failures[0]?.failure ?? null
    }
  })

const unexpected = (method: string): Effect.Effect<never> =>
  Effect.die(new Error(`unexpected ${method} call`))

const FakeProjects = Layer.succeed(Projects, {
  list: () => unexpected("Projects.list"),
  listPaged: () => unexpected("Projects.listPaged"),
  listMembersPaged: () => unexpected("Projects.listMembersPaged"),
  create: () => unexpected("Projects.create"),
  get: () => Effect.succeed(benchmarkProject),
  getKey: () => Effect.succeed(decodeProjectKey("T")),
  getGithubIntegration: () => Effect.succeed(null),
  update: () => unexpected("Projects.update"),
  updateSetup: () => unexpected("Projects.updateSetup"),
  remove: () => unexpected("Projects.remove"),
  requireMember: () => Effect.succeed({ role: "member" as const }),
  requireRole: () => unexpected("Projects.requireRole"),
  addMember: () => unexpected("Projects.addMember"),
  updateMember: () => unexpected("Projects.updateMember"),
  transferOwnership: () => unexpected("Projects.transferOwnership"),
  removeMember: () => unexpected("Projects.removeMember"),
  cancelPendingMember: () => unexpected("Projects.cancelPendingMember"),
  unassignUserFromActiveTickets: () =>
    unexpected("Projects.unassignUserFromActiveTickets"),
  connectGithub: () => unexpected("Projects.connectGithub"),
  disconnectGithub: () => unexpected("Projects.disconnectGithub")
} satisfies ProjectsShape)

const FakeGroups = Layer.succeed(Groups, {
  list: () => unexpected("Groups.list"),
  listPaged: () => unexpected("Groups.listPaged"),
  listSprintsPaged: () => unexpected("Groups.listSprintsPaged"),
  get: () => unexpected("Groups.get"),
  create: () => unexpected("Groups.create"),
  update: () => unexpected("Groups.update"),
  updateTickets: () => unexpected("Groups.updateTickets"),
  addTickets: () => unexpected("Groups.addTickets"),
  updateTicketOrder: () => unexpected("Groups.updateTicketOrder"),
  complete: () => unexpected("Groups.complete"),
  remove: () => unexpected("Groups.remove"),
  removeTicketFromAllGroups: () => Effect.void
} satisfies GroupsShape)

const FakeGitHub = Layer.succeed(GitHub, {
  getInstallationAccount: () => unexpected("GitHub.getInstallationAccount"),
  listInstallationRepos: () => unexpected("GitHub.listInstallationRepos"),
  verifyInstallationRepo: () => unexpected("GitHub.verifyInstallationRepo"),
  exchangeAppUserCode: () => unexpected("GitHub.exchangeAppUserCode"),
  appUserCanAccessInstallation: () =>
    unexpected("GitHub.appUserCanAccessInstallation"),
  createBranchAsUser: () => unexpected("GitHub.createBranchAsUser"),
  openPullRequestAsUser: () => unexpected("GitHub.openPullRequestAsUser"),
  fetchInstallationProjectStates: () =>
    unexpected("GitHub.fetchInstallationProjectStates"),
  listInstallationBranches: () => unexpected("GitHub.listInstallationBranches"),
  branchExistsInstallation: () => unexpected("GitHub.branchExistsInstallation")
} satisfies GitHubShape)

const FakeComments = Layer.succeed(Comments, {
  list: () => unexpected("Comments.list"),
  create: () => unexpected("Comments.create"),
  edit: () => unexpected("Comments.edit"),
  remove: () => unexpected("Comments.remove")
} satisfies CommentsShape)

const FakeAttachments = Layer.succeed(Attachments, {
  prepare: () => unexpected("Attachments.prepare"),
  commit: () => unexpected("Attachments.commit"),
  resolveForServing: () => unexpected("Attachments.resolveForServing"),
  reconcileTicket: () => Effect.void,
  reapOnce: () => unexpected("Attachments.reapOnce")
} satisfies AttachmentsShape)

const DocsLive = TicketDocsLive.pipe(
  Layer.provide(MarkdownLive),
  Layer.provideMerge(BunContext.layer)
)
const DatabaseLive = DbLive.pipe(Layer.provideMerge(PgLive))
const IndexLive = TicketIndexLive.pipe(
  Layer.provide(DocsLive),
  Layer.provide(DatabaseLive)
)
const BenchmarkLive = TicketsLive.pipe(
  Layer.provide(
    Layer.mergeAll(
      DocsLive,
      DatabaseLive,
      IndexLive,
      FakeProjects,
      FakeGroups,
      FakeGitHub,
      FakeComments,
      FakeAttachments
    )
  )
)

const seedFixture = async (
  options: Options,
  projectSlug: string,
  organizationId: string,
  projectId: string
) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(
      `insert into organization (id, name, slug, created_at)
       values ($1, 'Benchmark', $2, now())`,
      [organizationId, orgSlug]
    )
    await client.query(
      `insert into project_index
         (id, slug, organization_id, key, name, icon, color,
          next_ticket_number, created_by, created_at)
       values ($1, $2, $3, 'T', 'Benchmark', 'folder', 'blue', $4, $5, now())`,
      [projectId, projectSlug, organizationId, options.ticketCount + 1, userId]
    )
    await client.query(
      `insert into ticket_index
         (organization_id, org_slug, project_id, project_slug, ticket_id,
          title, status, type, priority, tags, assignees, created_by,
          created_at, updated_at)
       select $1, $2, $3, $4, 'T-' || value,
          'Benchmark ticket ' || value, 'todo', 'other', 'med', '{}', '{}', $5,
          '2026-01-01T00:00:00.000Z'::timestamptz,
          '2026-01-01T00:00:00.000Z'::timestamptz
       from generate_series(1, $6) as value`,
      [
        organizationId,
        orgSlug,
        projectId,
        projectSlug,
        userId,
        options.ticketCount
      ]
    )
  } finally {
    await client.end()
  }

  const ticketDirectory = join(
    options.projectsRoot,
    "orgs",
    orgSlug,
    "projects",
    projectSlug,
    "tickets"
  )
  await mkdir(ticketDirectory, { recursive: true })
  const workerCount = Math.min(32, options.ticketCount)
  await Promise.all(
    Array.from({ length: workerCount }, async (_, worker) => {
      for (
        let index = worker;
        index < options.ticketCount;
        index += workerCount
      ) {
        await writeFile(
          join(ticketDirectory, `T-${index + 1}.md`),
          ticketContent(index)
        )
      }
    })
  )
}

const cleanupFixture = async (
  options: Options,
  projectSlug: string,
  organizationId: string
) => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query("delete from organization where id = $1", [
      organizationId
    ])
  } finally {
    await client.end()
  }
  await rm(
    join(options.projectsRoot, "orgs", orgSlug, "projects", projectSlug),
    { recursive: true, force: true }
  )
}

const benchmarkProgram = (options: Options, projectSlug: string) =>
  Effect.gen(function* () {
    const tickets = yield* Tickets
    const results: Array<BenchmarkResult> = []
    let targetOffset = 0
    const targetId = (sample: number) =>
      `T-${((targetOffset + sample) % options.ticketCount) + 1}`
    const measure = <A, E>(
      operation: string,
      effectFor: (sample: number) => Effect.Effect<A, E>
    ) =>
      Effect.forEach(
        options.concurrencies,
        (concurrency) =>
          runWorkload(
            operation,
            concurrency,
            options.sampleCount,
            effectFor
          ).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                results.push(result)
                targetOffset +=
                  options.sampleCount + Math.min(10, options.sampleCount)
              })
            )
          ),
        { concurrency: 1, discard: true }
      )

    yield* measure("create", (sample) =>
      tickets.create(orgSlug, userId, projectSlug, {
        title: `Created benchmark ticket ${sample}`,
        body: makeBody(sample)
      })
    )
    yield* measure("update", (sample) =>
      tickets.update(orgSlug, userId, projectSlug, targetId(sample), {
        title: `Updated benchmark ticket ${sample}`
      })
    )
    yield* measure("update-with-ticket-mentions", (sample) =>
      tickets.update(orgSlug, userId, projectSlug, targetId(sample), {
        body: `${makeBody(sample)}\n\nSee [first](mention:ticket/T-1), [middle](mention:ticket/T-${Math.max(1, Math.floor(options.ticketCount / 2))}), and [last](mention:ticket/T-${options.ticketCount}).\n`
      })
    )

    return results
  }).pipe(Effect.provide(BenchmarkLive))

const printReport = (report: {
  readonly variant: string
  readonly round: number
  readonly ticketCount: number
  readonly seedTimeMs: number
  readonly results: ReadonlyArray<BenchmarkResult>
}) => {
  console.log(
    `${report.variant} round ${report.round}: ${report.ticketCount} tickets, seed ${report.seedTimeMs} ms`
  )
  console.table(
    report.results.map((result) => ({
      operation: result.operation,
      concurrency: result.concurrency,
      failures: result.failures,
      "p50 ms": result.p50Ms,
      "p95 ms": result.p95Ms,
      "p99 ms": result.p99Ms,
      "ops/sec": result.throughputPerSecond
    }))
  )
}

async function main() {
  const options = parseOptions()
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required")
  const suffix =
    `${options.variant}-${options.ticketCount}-${options.round}-${process.pid}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
  const projectSlug = `bench-${suffix}`
  const organizationId = `bench-org-${suffix}`
  const projectId = randomUUID()
  const seedStartedAt = performance.now()
  await seedFixture(options, projectSlug, organizationId, projectId)
  const seedTimeMs = round(performance.now() - seedStartedAt)
  try {
    const results = await Effect.runPromise(
      benchmarkProgram(options, projectSlug)
    )
    const report = {
      generatedAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        cpuCount: cpus().length,
        bunVersion: Bun.version
      },
      variant: options.variant,
      round: options.round,
      ticketCount: options.ticketCount,
      sampleCount: options.sampleCount,
      concurrencies: options.concurrencies,
      seedTimeMs,
      results
    }
    if (options.json) console.log(JSON.stringify(report))
    else printReport(report)
  } finally {
    await cleanupFixture(options, projectSlug, organizationId)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises"
import { arch, cpus, platform, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { BunContext } from "@effect/platform-bun"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { TicketId, TicketStatus } from "@projectproject/shared"
import { MarkdownLive } from "../src/Layers/Markdown"
import { TicketDocsLive } from "../src/Layers/TicketDocs"
import { TicketDocs, type TicketDocument } from "../src/Services/TicketDocs"

const benchmarkPrefix = "projectproject-ticket-storage-bench-"
const orgSlug = "benchmark"
const projectSlug = "ticket-storage"
const decodeTicketId = Schema.decodeUnknownSync(TicketId)
const decodeTicketStatus = Schema.decodeUnknownSync(TicketStatus)

interface Options {
  readonly scratchParent: string
  readonly ticketCount: number
  readonly sampleCount: number
  readonly concurrencies: ReadonlyArray<number>
  readonly keep: boolean
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
  if (value === undefined) return [1, 8, 32]
  const values = value
    .split(",")
    .map((part) => positiveInteger(part.trim(), 1, "--concurrency"))
  if (values.length === 0) throw new Error("--concurrency cannot be empty")
  return [...new Set(values)]
}

const parseOptions = (): Options => ({
  scratchParent: resolve(argumentValue("--scratch-parent") ?? tmpdir()),
  ticketCount: positiveInteger(argumentValue("--tickets"), 1_000, "--tickets"),
  sampleCount: positiveInteger(argumentValue("--samples"), 200, "--samples"),
  concurrencies: parseConcurrencies(argumentValue("--concurrency")),
  keep: process.argv.includes("--keep"),
  json: process.argv.includes("--json")
})

const printHelp = () => {
  console.log(`Usage: bun run benchmark:ticket-storage -- [options]

Options:
  --scratch-parent <path>  Existing directory in which a unique scratch directory is created
  --tickets <count>        Number of ticket files to seed (default: 1000)
  --samples <count>        Samples per operation and concurrency (default: 200)
  --concurrency <list>     Comma-separated concurrency levels (default: 1,8,32)
  --keep                   Keep the generated scratch directory
  --json                   Print the final report as JSON
  --help                   Show this help`)
}

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

const makeDocument = (index: number): TicketDocument => {
  const timestamp = new Date("2026-01-01T00:00:00.000Z")
  return {
    id: decodeTicketId(`T-${index + 1}`),
    title: `Benchmark ticket ${index + 1}`,
    status: decodeTicketStatus("todo"),
    type: "chore",
    priority: "med",
    tags: [],
    branch: null,
    pr: null,
    prState: null,
    lastTransitionedPr: null,
    assignees: [],
    archivedAt: null,
    createdBy: "benchmark-user",
    createdAt: timestamp,
    updatedAt: timestamp,
    body: makeBody(index),
    commentsRegion: ""
  }
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

const fromPromise = <A>(run: () => Promise<A>) => Effect.tryPromise(run)

const benchmarkProgram = (options: Options, scratchRoot: string) =>
  Effect.gen(function* () {
    const ticketDocs = yield* TicketDocs
    const documents = Array.from({ length: options.ticketCount }, (_, index) =>
      makeDocument(index)
    )
    const ticketDirectory = join(
      scratchRoot,
      "orgs",
      orgSlug,
      "projects",
      projectSlug,
      "tickets"
    )
    const fileFor = (sample: number) =>
      join(ticketDirectory, `T-${(sample % options.ticketCount) + 1}.md`)

    const seedStartedAt = yield* Clock.currentTimeNanos
    yield* Effect.forEach(
      documents,
      (document) => ticketDocs.create(orgSlug, projectSlug, document),
      { concurrency: Math.min(32, options.ticketCount), discard: true }
    )
    const seedFinishedAt = yield* Clock.currentTimeNanos
    const seededContent = yield* Effect.forEach(
      Array.from({ length: options.ticketCount }, (_, index) => index),
      (index) => fromPromise(() => readFile(fileFor(index), "utf8")),
      { concurrency: Math.min(32, options.ticketCount) }
    )

    const results: Array<BenchmarkResult> = []
    const measure = <A, E>(
      operation: string,
      effectFor: (sample: number, concurrency: number) => Effect.Effect<A, E>
    ) =>
      Effect.forEach(
        options.concurrencies,
        (concurrency) =>
          runWorkload(operation, concurrency, options.sampleCount, (sample) =>
            effectFor(sample, concurrency)
          ).pipe(
            Effect.tap((result) => Effect.sync(() => results.push(result)))
          ),
        { concurrency: 1, discard: true }
      )

    yield* measure("raw-read", (sample) =>
      fromPromise(() => readFile(fileFor(sample), "utf8"))
    )
    yield* measure("raw-readdir", () =>
      fromPromise(() => readdir(ticketDirectory))
    )
    yield* measure("ticket-docs-read", (sample) =>
      ticketDocs.read(
        orgSlug,
        projectSlug,
        `T-${(sample % options.ticketCount) + 1}`
      )
    )
    yield* measure("ticket-docs-list-ids", () =>
      ticketDocs.listIds(orgSlug, projectSlug)
    )
    yield* measure("ticket-docs-update-atomic", (sample) => {
      const id = `T-${(sample % options.ticketCount) + 1}`
      return ticketDocs.read(orgSlug, projectSlug, id).pipe(
        Effect.flatMap((document) =>
          ticketDocs.write(orgSlug, projectSlug, id, {
            ...document,
            updatedAt: new Date(document.updatedAt.getTime() + 1)
          })
        )
      )
    })
    yield* measure("raw-direct-write", (sample) => {
      const index = sample % options.ticketCount
      return fromPromise(() => writeFile(fileFor(sample), seededContent[index]))
    })
    yield* measure("raw-atomic-replace", (sample, concurrency) => {
      const index = sample % options.ticketCount
      const file = fileFor(sample)
      const temporary = `${file}.${process.pid}-${concurrency}-${sample}.tmp`
      return fromPromise(async () => {
        await writeFile(temporary, seededContent[index])
        await rename(temporary, file)
      })
    })

    return {
      generatedAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        cpuCount: cpus().length,
        bunVersion: Bun.version,
        scratchParent: options.scratchParent
      },
      configuration: {
        ticketCount: options.ticketCount,
        sampleCount: options.sampleCount,
        concurrencies: options.concurrencies,
        bodyDistribution: {
          fourKiB: "75%",
          sixteenKiB: "20%",
          sixtyFourKiB: "5%"
        }
      },
      setup: {
        seedTimeMs: round(Number(seedFinishedAt - seedStartedAt) / 1_000_000)
      },
      results
    }
  }).pipe(
    Effect.provide(
      TicketDocsLive.pipe(
        Layer.provide(MarkdownLive),
        Layer.provideMerge(
          Layer.setConfigProvider(
            ConfigProvider.fromMap(new Map([["PROJECTS_DIR", scratchRoot]]))
          )
        ),
        Layer.provideMerge(BunContext.layer)
      )
    )
  )

const printReport = (
  report: Effect.Effect.Success<ReturnType<typeof benchmarkProgram>>
) => {
  console.log("Ticket filesystem benchmark")
  console.log(`Scratch parent: ${report.environment.scratchParent}`)
  console.log(`Runtime: Bun ${report.environment.bunVersion}`)
  console.log(
    `Host: ${report.environment.platform}/${report.environment.architecture}, ${report.environment.cpuCount} CPUs`
  )
  console.log(
    `Corpus: ${report.configuration.ticketCount} tickets, ${report.configuration.sampleCount} samples per row`
  )
  console.log(`Seed time: ${report.setup.seedTimeMs} ms`)
  console.table(
    report.results.map((result) => ({
      operation: result.operation,
      concurrency: result.concurrency,
      samples: result.samples,
      failures: result.failures,
      "p50 ms": result.p50Ms,
      "p95 ms": result.p95Ms,
      "p99 ms": result.p99Ms,
      "ops/sec": result.throughputPerSecond
    }))
  )
  for (const result of report.results) {
    if (result.firstFailure !== null) {
      console.error(
        `${result.operation} at concurrency ${result.concurrency} failed:\n${result.firstFailure}`
      )
    }
  }
}

async function main() {
  if (process.argv.includes("--help")) {
    printHelp()
    return
  }

  const options = parseOptions()
  const maxConcurrency = Math.max(...options.concurrencies)
  if (options.ticketCount < maxConcurrency) {
    throw new Error(
      `--tickets must be at least the maximum concurrency (${maxConcurrency})`
    )
  }
  const parentStats = await stat(options.scratchParent)
  if (!parentStats.isDirectory()) {
    throw new Error(
      `scratch parent is not a directory: ${options.scratchParent}`
    )
  }

  const scratchRoot = await mkdtemp(
    join(options.scratchParent, benchmarkPrefix)
  )
  try {
    if (!options.json) console.log(`Created scratch directory: ${scratchRoot}`)
    const report = await Effect.runPromise(
      benchmarkProgram(options, scratchRoot)
    )
    if (options.json) console.log(JSON.stringify(report, null, 2))
    else printReport(report)
  } finally {
    if (options.keep) {
      if (!options.json) console.log(`Kept scratch directory: ${scratchRoot}`)
    } else {
      await rm(scratchRoot, { recursive: true, force: true })
      if (!options.json)
        console.log(`Removed scratch directory: ${scratchRoot}`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

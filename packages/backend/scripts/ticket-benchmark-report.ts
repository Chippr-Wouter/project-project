import * as Schema from "effect/Schema"

export interface BenchmarkResult {
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

export interface BenchmarkReport {
  readonly generatedAt: string
  readonly environment: {
    readonly platform: string
    readonly architecture: string
    readonly cpuCount: number
    readonly bunVersion: string
  }
  readonly variant: string
  readonly round: number
  readonly ticketCount: number
  readonly sampleCount: number
  readonly concurrencies: ReadonlyArray<number>
  readonly seedTimeMs: number
  readonly results: ReadonlyArray<BenchmarkResult>
}

export interface BenchmarkComparison {
  readonly operation: string
  readonly concurrency: number
  readonly beforeP95Ms: number
  readonly afterP95Ms: number
  readonly p95ChangePercent: number | null
  readonly beforeThroughputPerSecond: number
  readonly afterThroughputPerSecond: number
  readonly throughputChangePercent: number | null
  readonly beforeFailures: number
  readonly afterFailures: number
}

const BenchmarkResultSchema = Schema.Struct({
  operation: Schema.String,
  concurrency: Schema.Number,
  samples: Schema.Number,
  failures: Schema.Number,
  p50Ms: Schema.Number,
  p95Ms: Schema.Number,
  p99Ms: Schema.Number,
  throughputPerSecond: Schema.Number,
  wallTimeMs: Schema.Number,
  firstFailure: Schema.NullOr(Schema.String)
})

const BenchmarkReportSchema = Schema.Struct({
  generatedAt: Schema.String,
  environment: Schema.Struct({
    platform: Schema.String,
    architecture: Schema.String,
    cpuCount: Schema.Number,
    bunVersion: Schema.String
  }),
  variant: Schema.String,
  round: Schema.Number,
  ticketCount: Schema.Number,
  sampleCount: Schema.Number,
  concurrencies: Schema.Array(Schema.Number),
  seedTimeMs: Schema.Number,
  results: Schema.Array(BenchmarkResultSchema)
})

const decodeBenchmarkReports = Schema.decodeUnknownSync(
  Schema.Array(BenchmarkReportSchema)
)

export const parseBenchmarkReports = (
  content: string
): ReadonlyArray<BenchmarkReport> => {
  const trimmed = content.trim()
  if (trimmed === "") return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    parsed = trimmed
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as unknown)
  }
  return decodeBenchmarkReports(Array.isArray(parsed) ? parsed : [parsed])
}

const round = (value: number): number => Math.round(value * 100) / 100

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) throw new Error("cannot take median of no values")
  const sorted = values.toSorted((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const percentChange = (before: number, after: number): number | null =>
  before === 0 ? null : round(((after - before) / before) * 100)

const resultKey = (result: BenchmarkResult): string =>
  `${result.operation}:${result.concurrency}`

const sameNumbers = (
  left: ReadonlyArray<number>,
  right: ReadonlyArray<number>
): boolean =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const assertConfigurationMatches = (
  expected: BenchmarkReport,
  actual: BenchmarkReport,
  context: string
): void => {
  if (actual.ticketCount !== expected.ticketCount) {
    throw new Error(`${context} ticketCount does not match`)
  }
  if (actual.sampleCount !== expected.sampleCount) {
    throw new Error(`${context} sampleCount does not match`)
  }
  if (!sameNumbers(actual.concurrencies, expected.concurrencies)) {
    throw new Error(`${context} concurrencies do not match`)
  }
  if (actual.environment.platform !== expected.environment.platform) {
    throw new Error(`${context} platform does not match`)
  }
  if (actual.environment.architecture !== expected.environment.architecture) {
    throw new Error(`${context} architecture does not match`)
  }
  if (actual.environment.cpuCount !== expected.environment.cpuCount) {
    throw new Error(`${context} cpuCount does not match`)
  }
  if (actual.environment.bunVersion !== expected.environment.bunVersion) {
    throw new Error(`${context} bunVersion does not match`)
  }
}

const sortedResultKeys = (
  results: ReadonlyArray<BenchmarkResult>
): ReadonlyArray<string> =>
  results.map(resultKey).toSorted((left, right) => left.localeCompare(right))

const assertValuesMatch = (
  expected: ReadonlyArray<string>,
  actual: ReadonlyArray<string>,
  message: string
): void => {
  if (
    expected.length !== actual.length ||
    expected.some((key, index) => key !== actual[index])
  ) {
    throw new Error(message)
  }
}

interface ValidatedReportSet {
  readonly first: BenchmarkReport
  readonly rounds: ReadonlyArray<number>
  readonly resultKeys: ReadonlyArray<string>
}

const validateReportSet = (
  label: string,
  reports: ReadonlyArray<BenchmarkReport>
): ValidatedReportSet => {
  const first = reports[0]
  if (!first) throw new Error(`${label} reports are empty`)
  const resultKeys = sortedResultKeys(first.results)
  if (new Set(resultKeys).size !== resultKeys.length) {
    throw new Error(`${label} reports contain duplicate result keys`)
  }
  for (const report of reports) {
    assertConfigurationMatches(first, report, `${label} reports`)
    if (report.variant !== first.variant) {
      throw new Error(`${label} reports contain mixed variants`)
    }
    assertValuesMatch(
      resultKeys,
      sortedResultKeys(report.results),
      `${label} reports result keys do not match`
    )
    for (const result of report.results) {
      if (result.samples !== report.sampleCount) {
        throw new Error(`${label} report result samples do not match`)
      }
      if (!report.concurrencies.includes(result.concurrency)) {
        throw new Error(`${label} report contains an undeclared concurrency`)
      }
      if (result.failures > 0) {
        throw new Error(`${label} report contains failed samples`)
      }
    }
  }
  const rounds = reports
    .map((report) => report.round)
    .toSorted((left, right) => left - right)
  if (new Set(rounds).size !== rounds.length) {
    throw new Error(`${label} reports contain duplicate rounds`)
  }
  return { first, rounds, resultKeys }
}

const resultsByKey = (
  reports: ReadonlyArray<BenchmarkReport>
): ReadonlyMap<string, ReadonlyArray<BenchmarkResult>> => {
  const grouped = new Map<string, Array<BenchmarkResult>>()
  for (const report of reports) {
    for (const result of report.results) {
      const key = resultKey(result)
      const current = grouped.get(key)
      if (current) current.push(result)
      else grouped.set(key, [result])
    }
  }
  return grouped
}

export const compareBenchmarkReports = (
  beforeReports: ReadonlyArray<BenchmarkReport>,
  afterReports: ReadonlyArray<BenchmarkReport>
): ReadonlyArray<BenchmarkComparison> => {
  const beforeSet = validateReportSet("before", beforeReports)
  const afterSet = validateReportSet("after", afterReports)
  assertConfigurationMatches(
    beforeSet.first,
    afterSet.first,
    "before and after reports"
  )
  assertValuesMatch(
    beforeSet.rounds.map(String),
    afterSet.rounds.map(String),
    "before and after round sets do not match"
  )
  assertValuesMatch(
    beforeSet.resultKeys,
    afterSet.resultKeys,
    "before and after report result keys do not match"
  )
  const before = resultsByKey(beforeReports)
  const after = resultsByKey(afterReports)
  return [...before.entries()].map(([key, beforeResults]) => {
    const afterResults = after.get(key)
    if (!afterResults) throw new Error(`after reports are missing ${key}`)
    const beforeP95Ms = median(beforeResults.map((result) => result.p95Ms))
    const afterP95Ms = median(afterResults.map((result) => result.p95Ms))
    const beforeThroughputPerSecond = median(
      beforeResults.map((result) => result.throughputPerSecond)
    )
    const afterThroughputPerSecond = median(
      afterResults.map((result) => result.throughputPerSecond)
    )
    return {
      operation: beforeResults[0].operation,
      concurrency: beforeResults[0].concurrency,
      beforeP95Ms: round(beforeP95Ms),
      afterP95Ms: round(afterP95Ms),
      p95ChangePercent: percentChange(beforeP95Ms, afterP95Ms),
      beforeThroughputPerSecond: round(beforeThroughputPerSecond),
      afterThroughputPerSecond: round(afterThroughputPerSecond),
      throughputChangePercent: percentChange(
        beforeThroughputPerSecond,
        afterThroughputPerSecond
      ),
      beforeFailures: round(
        median(beforeResults.map((result) => result.failures))
      ),
      afterFailures: round(
        median(afterResults.map((result) => result.failures))
      )
    }
  })
}

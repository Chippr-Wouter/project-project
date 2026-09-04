import { describe, expect, it } from "vitest"
import {
  compareBenchmarkReports,
  parseBenchmarkReports,
  type BenchmarkReport
} from "../scripts/ticket-benchmark-report"

const report = (
  variant: string,
  round: number,
  p95Ms: number,
  throughputPerSecond: number,
  failures: number
): BenchmarkReport => ({
  generatedAt: "2026-01-01T00:00:00.000Z",
  environment: {
    platform: "linux",
    architecture: "arm64",
    cpuCount: 8,
    bunVersion: "1.2.13"
  },
  variant,
  round,
  ticketCount: 10_000,
  sampleCount: 100,
  concurrencies: [1],
  seedTimeMs: 100,
  results: [
    {
      operation: "list-default",
      concurrency: 1,
      samples: 100,
      failures,
      p50Ms: p95Ms / 2,
      p95Ms,
      p99Ms: p95Ms * 2,
      throughputPerSecond,
      wallTimeMs: 1_000,
      firstFailure: failures === 0 ? null : "failed"
    }
  ]
})

describe("compareBenchmarkReports", () => {
  it("compares median results across benchmark rounds", () => {
    const comparisons = compareBenchmarkReports(
      [
        report("before", 1, 10, 100, 0),
        report("before", 2, 14, 80, 0),
        report("before", 3, 12, 90, 0)
      ],
      [
        report("after", 1, 6, 180, 0),
        report("after", 2, 4, 220, 0),
        report("after", 3, 5, 200, 0)
      ]
    )

    expect(comparisons).toEqual([
      {
        operation: "list-default",
        concurrency: 1,
        beforeP95Ms: 12,
        afterP95Ms: 5,
        p95ChangePercent: -58.33,
        beforeThroughputPerSecond: 90,
        afterThroughputPerSecond: 200,
        throughputChangePercent: 122.22,
        beforeFailures: 0,
        afterFailures: 0
      }
    ])
  })

  it("parses newline-delimited reports from repeated benchmark rounds", () => {
    const first = report("before", 1, 10, 100, 0)
    const second = report("before", 2, 12, 90, 0)

    expect(
      parseBenchmarkReports(
        `${JSON.stringify(first)}\n${JSON.stringify(second)}`
      )
    ).toEqual([first, second])
  })

  it("rejects comparisons with different benchmark configurations", () => {
    const before = report("before", 1, 10, 100, 0)
    const after = report("after", 1, 5, 200, 0)

    expect(() =>
      compareBenchmarkReports(
        [before],
        [{ ...after, ticketCount: after.ticketCount * 2 }]
      )
    ).toThrow("ticketCount")
  })

  it("rejects comparisons with different workload sets", () => {
    const before = report("before", 1, 10, 100, 0)
    const after = report("after", 1, 5, 200, 0)
    const detail = { ...after.results[0], operation: "detail" }

    expect(() =>
      compareBenchmarkReports(
        [before],
        [{ ...after, results: [...after.results, detail] }]
      )
    ).toThrow("result keys")
  })

  it("rejects comparisons containing failed samples", () => {
    expect(() =>
      compareBenchmarkReports(
        [report("before", 1, 10, 100, 1)],
        [report("after", 1, 5, 200, 0)]
      )
    ).toThrow("failed samples")
  })
})

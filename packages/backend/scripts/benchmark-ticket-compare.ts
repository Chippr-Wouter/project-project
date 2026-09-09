import { readFile } from "node:fs/promises"
import {
  compareBenchmarkReports,
  parseBenchmarkReports
} from "./ticket-benchmark-report"

const argumentValue = (name: string): string | undefined => {
  const prefix = `${name}=`
  const inline = process.argv.find((argument) => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const beforePath = argumentValue("--before")
const afterPath = argumentValue("--after")

if (!beforePath || !afterPath) {
  throw new Error("pass --before <jsonl> and --after <jsonl>")
}

const [beforeContent, afterContent] = await Promise.all([
  readFile(beforePath, "utf8"),
  readFile(afterPath, "utf8")
])
const comparisons = compareBenchmarkReports(
  parseBenchmarkReports(beforeContent),
  parseBenchmarkReports(afterContent)
)

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(comparisons))
} else {
  console.table(
    comparisons.map((comparison) => ({
      operation: comparison.operation,
      concurrency: comparison.concurrency,
      "before p95 ms": comparison.beforeP95Ms,
      "after p95 ms": comparison.afterP95Ms,
      "p95 change %": comparison.p95ChangePercent,
      "before ops/sec": comparison.beforeThroughputPerSecond,
      "after ops/sec": comparison.afterThroughputPerSecond,
      "throughput change %": comparison.throughputChangePercent,
      "before failures": comparison.beforeFailures,
      "after failures": comparison.afterFailures
    }))
  )
}

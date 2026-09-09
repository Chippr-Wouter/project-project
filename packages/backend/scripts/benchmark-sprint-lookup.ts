import { mkdtemp, rm } from "node:fs/promises"
import { arch, cpus, platform, tmpdir } from "node:os"
import { join } from "node:path"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as ConfigProvider from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import { GroupDetail } from "@projectproject/shared"
import { GroupDocsLive } from "../src/Layers/GroupDocs"
import { MarkdownLive } from "../src/Layers/Markdown"
import { GroupDocs } from "../src/Services/GroupDocs"
import { resolveSprintForTicket } from "../src/Layers/EverhourTimeTracking"

const groupCount = Number(process.argv[2] ?? 100)
if (!Number.isSafeInteger(groupCount) || groupCount < 8) {
  throw new Error("Group count must be an integer of at least 8")
}
const samples = 100
const org = "benchmark"
const project = "sprint-lookup"
const scratch = await mkdtemp(
  join(
    process.env.BENCH_SCRATCH_PARENT ?? tmpdir(),
    "projectproject-sprint-bench-"
  )
)

try {
  const results = await Effect.runPromise(
    Effect.gen(function* () {
      const docs = yield* GroupDocs
      yield* Effect.forEach(
        Array.from({ length: groupCount }, (_, i) => i),
        (i) =>
          docs.create(
            org,
            project,
            Schema.decodeSync(GroupDetail)({
              id: `G-${i + 1}`,
              name: `Group ${i + 1}`,
              kind: i % 5 === 4 ? "epic" : "sprint",
              tickets: Array.from(
                { length: 20 },
                (_, j) => `T-${i * 20 + j + 1}`
              ),
              color: "#9ca3af",
              startsAt: null,
              endsAt: null,
              completedAt: null,
              createdBy: "benchmark-user",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
              body: "Representative group context.\n"
                .repeat(2400)
                .slice(0, (i % 20 === 0 ? 64 : i % 4 === 0 ? 16 : 4) * 1024)
            })
          ),
        { concurrency: 8, discard: true }
      )

      let active = 0
      let peak = 0
      const lookup = Effect.fn(function* (concurrency: number) {
        const ids = yield* docs.listIds(org, project).pipe(Effect.orDie)
        const groups = yield* Effect.forEach(
          ids,
          (id) =>
            Effect.suspend(() => {
              active++
              peak = Math.max(peak, active)
              return docs.read(org, project, id).pipe(
                Effect.catchTag("NotFound", () => Effect.succeed(null)),
                Effect.orDie,
                Effect.ensuring(
                  Effect.sync(() => {
                    active--
                  })
                )
              )
            }),
          { concurrency }
        )
        const sprints = groups.filter(
          (group) => group !== null && group.kind === "sprint"
        )
        if (resolveSprintForTicket(sprints, "T-1") !== "G-1") {
          return yield* Effect.die(new Error("Sprint resolution changed"))
        }
      })

      const rows = []
      for (const [round, order] of [
        [1, 8],
        [8, 1],
        [1, 8]
      ].entries()) {
        for (const concurrency of order) {
          for (let i = 0; i < 10; i++) yield* lookup(concurrency)
          peak = 0
          const timings = []
          const started = performance.now()
          for (let i = 0; i < samples; i++) {
            const sampleStart = performance.now()
            yield* lookup(concurrency)
            timings.push(performance.now() - sampleStart)
          }
          const elapsed = performance.now() - started
          timings.sort((a, b) => a - b)
          rows.push({
            round: round + 1,
            concurrency,
            peak,
            samples,
            p50Ms: timings[49],
            p95Ms: timings[94],
            p99Ms: timings[98],
            throughput: (samples * 1000) / elapsed
          })
        }
      }
      return rows
    }).pipe(
      Effect.provide(
        GroupDocsLive.pipe(
          Layer.provide(MarkdownLive),
          Layer.provideMerge(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ PROJECTS_DIR: scratch })
            )
          ),
          Layer.provideMerge(BunServices.layer)
        )
      )
    )
  )
  console.log(
    JSON.stringify(
      {
        groupCount,
        samples,
        warmups: 10,
        environment: {
          platform: platform(),
          arch: arch(),
          cpus: cpus().length,
          bun: Bun.version
        },
        results
      },
      null,
      2
    )
  )
} finally {
  await rm(scratch, { recursive: true, force: true })
}

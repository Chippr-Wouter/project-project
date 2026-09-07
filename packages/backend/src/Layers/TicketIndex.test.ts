import { it } from "@effect/vitest"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { describe, expect } from "vite-plus/test"
import { TicketId, TicketStatus } from "@projectproject/shared"
import {
  detectTicketIndexDrift,
  makeTicketIndexReconciler,
  ticketIndexHasDrift,
  type TicketIndexReconcilerDeps
} from "./TicketIndex"
import type { TicketDocument } from "../Services/TicketDocs"
import type { TicketIndexProject } from "../Services/TicketIndex"

const ticketId = Schema.decodeUnknownSync(TicketId)
const ticketStatus = Schema.decodeUnknownSync(TicketStatus)
const at = (iso: string) => DateTime.toDate(DateTime.makeUnsafe(iso))

const project: TicketIndexProject = {
  orgSlug: "acme",
  organizationId: "org-1",
  projectId: "project-1",
  projectSlug: "demo"
}

const doc = (
  id: string,
  updatedAt: string,
  overrides: Partial<TicketDocument> = {}
): TicketDocument => ({
  id: ticketId(id),
  title: `Ticket ${id}`,
  status: ticketStatus("todo"),
  type: "feat",
  priority: "med",
  tags: [],
  branch: null,
  pr: null,
  prState: null,
  lastTransitionedPr: null,
  assignees: [],
  archivedAt: null,
  createdBy: "user-1",
  createdAt: at("2026-05-01T00:00:00.000Z"),
  updatedAt: at(updatedAt),
  body: "",
  ...overrides
})

describe("detectTicketIndexDrift", () => {
  it.effect("reports no drift when index matches the documents", () =>
    Effect.sync(() => {
      const drift = detectTicketIndexDrift(
        [
          { ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") },
          { ticketId: "T-2", updatedAt: at("2026-05-03T00:00:00.000Z") }
        ],
        [
          { id: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") },
          { id: "T-2", updatedAt: at("2026-05-03T00:00:00.000Z") }
        ]
      )
      expect(drift).toEqual({ missing: [], orphaned: [], stale: [] })
      expect(ticketIndexHasDrift(drift)).toBe(false)
    })
  )

  it.effect("flags a document with no index row as missing", () =>
    Effect.sync(() => {
      const drift = detectTicketIndexDrift(
        [{ ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") }],
        [
          { id: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") },
          { id: "T-2", updatedAt: at("2026-05-03T00:00:00.000Z") }
        ]
      )
      expect(drift).toEqual({ missing: ["T-2"], orphaned: [], stale: [] })
      expect(ticketIndexHasDrift(drift)).toBe(true)
    })
  )

  it.effect("flags an index row with a mismatched timestamp as stale", () =>
    Effect.sync(() => {
      const drift = detectTicketIndexDrift(
        [{ ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") }],
        [{ id: "T-1", updatedAt: at("2026-05-09T00:00:00.000Z") }]
      )
      expect(drift).toEqual({ missing: [], orphaned: [], stale: ["T-1"] })
      expect(ticketIndexHasDrift(drift)).toBe(true)
    })
  )

  it.effect("flags an index row with no backing document as orphaned", () =>
    Effect.sync(() => {
      const drift = detectTicketIndexDrift(
        [
          { ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") },
          { ticketId: "T-9", updatedAt: at("2026-05-02T00:00:00.000Z") }
        ],
        [{ id: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") }]
      )
      expect(drift).toEqual({ missing: [], orphaned: ["T-9"], stale: [] })
      expect(ticketIndexHasDrift(drift)).toBe(true)
    })
  )

  it.effect("reports each drift category together", () =>
    Effect.sync(() => {
      const drift = detectTicketIndexDrift(
        [
          { ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") },
          { ticketId: "T-9", updatedAt: at("2026-05-02T00:00:00.000Z") }
        ],
        [
          { id: "T-1", updatedAt: at("2026-05-05T00:00:00.000Z") },
          { id: "T-2", updatedAt: at("2026-05-03T00:00:00.000Z") }
        ]
      )
      expect(drift).toEqual({
        missing: ["T-2"],
        orphaned: ["T-9"],
        stale: ["T-1"]
      })
    })
  )
})

interface Harness {
  readonly deps: TicketIndexReconcilerDeps
  readonly writes: Array<{
    project: TicketIndexProject
    documents: ReadonlyArray<TicketDocument>
  }>
}

const makeHarness = (config: {
  projects?: ReadonlyArray<TicketIndexProject>
  documents: ReadonlyArray<TicketDocument>
  skipped?: number
  indexed: ReadonlyArray<{ ticketId: string; updatedAt: Date }>
}): Harness => {
  const writes: Harness["writes"] = []
  const deps: TicketIndexReconcilerDeps = {
    listProjects: Effect.succeed(config.projects ?? [project]),
    collectDocuments: () =>
      Effect.succeed({
        documents: config.documents,
        skipped: config.skipped ?? 0
      }),
    indexedRefs: () => Effect.succeed(config.indexed),
    writeProject: (writtenProject, documents) =>
      Effect.sync(() => {
        writes.push({ project: writtenProject, documents })
      })
  }
  return { deps, writes }
}

describe("makeTicketIndexReconciler", () => {
  it.effect("does not rebuild a project that has not drifted", () =>
    Effect.gen(function* () {
      const { deps, writes } = makeHarness({
        documents: [doc("T-1", "2026-05-02T00:00:00.000Z")],
        indexed: [
          { ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") }
        ]
      })
      const reconciler = makeTicketIndexReconciler(deps)
      const summary = yield* reconciler.reconcileProject(project)
      expect(summary.rebuilt).toBe(false)
      expect(summary.drift).toEqual({ missing: [], orphaned: [], stale: [] })
      expect(summary.indexed).toBe(1)
      expect(writes).toHaveLength(0)
    })
  )

  it.effect("rebuilds from the documents when the index drifted", () =>
    Effect.gen(function* () {
      const documents = [
        doc("T-1", "2026-05-05T00:00:00.000Z"),
        doc("T-2", "2026-05-03T00:00:00.000Z")
      ]
      const { deps, writes } = makeHarness({
        documents,
        skipped: 1,
        indexed: [
          { ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") },
          { ticketId: "T-9", updatedAt: at("2026-05-02T00:00:00.000Z") }
        ]
      })
      const reconciler = makeTicketIndexReconciler(deps)
      const summary = yield* reconciler.reconcileProject(project)
      expect(summary.rebuilt).toBe(true)
      expect(summary.drift).toEqual({
        missing: ["T-2"],
        orphaned: ["T-9"],
        stale: ["T-1"]
      })
      expect(summary.indexed).toBe(2)
      expect(summary.skipped).toBe(1)
      expect(writes).toHaveLength(1)
      expect(writes[0]!.documents).toBe(documents)
    })
  )

  it.effect("force rebuilds even when the project has not drifted", () =>
    Effect.gen(function* () {
      const documents = [doc("T-1", "2026-05-02T00:00:00.000Z")]
      const { deps, writes } = makeHarness({
        documents,
        indexed: [
          { ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") }
        ]
      })
      const reconciler = makeTicketIndexReconciler(deps)
      const summary = yield* reconciler.reconcileProject(project, {
        force: true
      })
      expect(summary.rebuilt).toBe(true)
      expect(summary.drift).toEqual({ missing: [], orphaned: [], stale: [] })
      expect(writes).toHaveLength(1)
      expect(writes[0]!.documents).toBe(documents)
    })
  )

  it.effect("reconcileAllProjects counts only the projects it rebuilt", () =>
    Effect.gen(function* () {
      const projectB: TicketIndexProject = {
        ...project,
        projectId: "project-2",
        projectSlug: "beta"
      }
      const documents = [doc("T-1", "2026-05-02T00:00:00.000Z")]
      const writes: Array<string> = []
      const deps: TicketIndexReconcilerDeps = {
        listProjects: Effect.succeed([project, projectB]),
        collectDocuments: () => Effect.succeed({ documents, skipped: 0 }),
        indexedRefs: (target) =>
          Effect.succeed(
            target.projectId === project.projectId
              ? [{ ticketId: "T-1", updatedAt: at("2026-05-02T00:00:00.000Z") }]
              : []
          ),
        writeProject: (target) =>
          Effect.sync(() => {
            writes.push(target.projectId)
          })
      }
      const reconciler = makeTicketIndexReconciler(deps)
      const summary = yield* reconciler.reconcileAllProjects()
      expect(summary.projects).toHaveLength(2)
      expect(summary.reconciled).toBe(1)
      expect(writes).toEqual(["project-2"])
    })
  )
})

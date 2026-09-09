import { it } from "@effect/vitest"
import { expect } from "vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import { Db } from "../Services/Db"
import { GitHub } from "../Services/GitHub"
import { ProjectDocs } from "../Services/ProjectDocs"
import { Projects } from "../Services/Projects"
import { TicketDocs } from "../Services/TicketDocs"
import { TicketIndex } from "../Services/TicketIndex"
import { Users } from "../Services/Users"
import * as TicketDocumentLock from "../ticketDocumentLock"
import { ProjectsLive } from "./Projects"

for (const scenario of [
  { projectRole: "owner", orgRole: null, allowed: true, queries: 4 },
  { projectRole: "member", orgRole: "member", allowed: true, queries: 5 },
  { projectRole: null, orgRole: "admin", allowed: true, queries: 5 },
  { projectRole: null, orgRole: "member", allowed: false, queries: 4 }
] as const) {
  it.effect(
    `loads authorized project context once for ${scenario.projectRole}/${scenario.orgRole}`,
    () => {
      const calls: string[] = []
      const query = <A>(name: string, value: A) =>
        Effect.sync(() => {
          calls.push(name)
          return value
        })
      const layer = ProjectsLive.pipe(
        Layer.provide(TicketDocumentLock.layer),
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(Db, {
              query: {
                organization: {
                  findFirst: () => query("organization", { id: "org-1" })
                },
                projectIndex: {
                  findFirst: () =>
                    query("project", {
                      id: "project-1",
                      organizationId: "org-1"
                    })
                },
                projectMember: {
                  findFirst: () =>
                    query(
                      "project-member",
                      scenario.projectRole
                        ? { role: scenario.projectRole }
                        : undefined
                    )
                },
                member: {
                  findFirst: () =>
                    query(
                      "org-member",
                      scenario.orgRole ? { role: scenario.orgRole } : undefined
                    )
                }
              },
              select: () => ({
                from: () => {
                  const chain = {
                    innerJoin: () => chain,
                    where: () => ({ limit: () => query("integration", []) })
                  }
                  return chain
                }
              })
            } as never),
            Layer.succeed(SqlClient.SqlClient, {} as never),
            Layer.mock(ProjectDocs, {}),
            Layer.mock(TicketDocs, {}),
            Layer.mock(TicketIndex, {}),
            Layer.mock(Users, {}),
            Layer.mock(GitHub, {})
          )
        )
      )
      return Effect.gen(function* () {
        const projects = yield* Projects
        const result = yield* Effect.result(
          projects.getGithubIntegration("org", "user", "project")
        )
        expect(result._tag).toBe(scenario.allowed ? "Success" : "Failure")
        if (result._tag === "Failure")
          expect(result.failure._tag).toBe("NotFound")
        expect(calls).toHaveLength(scenario.queries)
        expect(calls.filter((name) => name === "project")).toHaveLength(1)
        expect(calls.includes("integration")).toBe(scenario.allowed)
      }).pipe(Effect.provide(layer))
    }
  )
}

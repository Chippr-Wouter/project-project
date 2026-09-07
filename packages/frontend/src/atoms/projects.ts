import * as Result from "effect/unstable/reactivity/AsyncResult"
import * as Atom from "effect/unstable/reactivity/Atom"
import * as Reactivity from "effect/unstable/reactivity/Reactivity"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { runtime } from "@/runtime"
import { ApiClient } from "@/services/ApiClient"
import {
  CreatableProjectKey,
  type ProjectSetup,
  type UpdateProjectInput as UpdateProjectInputShared
} from "@projectproject/shared"

// Atom.family keys must compare by value, not reference. Slugs are DNS-safe
// (no `/`), so a slash is an unambiguous separator between org and project.
export const projectKey = (orgSlug: string, slug: string) =>
  `${orgSlug}/${slug}`

const splitProjectKey = (key: string): { orgSlug: string; slug: string } => {
  const sep = key.indexOf("/")
  return { orgSlug: key.slice(0, sep), slug: key.slice(sep + 1) }
}

const projectsListBaseAtom = Atom.family((orgSlug: string) =>
  runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.projects.list({ params: { orgSlug } })
      })
    )
    .pipe(Atom.setIdleTTL("1 minute"))
)

export const projectsListAtom = projectsListBaseAtom

export const projectBaseAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime
    .atom(
      Effect.gen(function* () {
        const client = yield* ApiClient
        return yield* client.projects.get({ params: { orgSlug, slug } })
      })
    )
    .pipe(Atom.setIdleTTL("2 minutes"))
})

export const projectAtom = Atom.family((key: string) =>
  Atom.optimistic(projectBaseAtom(key))
)

export const updateProjectAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectAtom(key), {
    reducer: (current, input: UpdateProjectInputShared) =>
      Result.isSuccess(current)
        ? Result.success({ ...current.value, ...input }, { waiting: true })
        : current,
    fn: runtime.fn(
      Effect.fn(function* (input: UpdateProjectInputShared, get) {
        const client = yield* ApiClient
        const updated = yield* client.projects.update({
          params: { orgSlug, slug },
          payload: input
        })
        get.refresh(projectBaseAtom(key))
        get.refresh(projectsListBaseAtom(orgSlug))
        return updated
      })
    )
  })
})

export const updateProjectSetupAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return Atom.optimisticFn(projectAtom(key), {
    reducer: (
      current,
      input: Partial<Record<keyof ProjectSetup, Date | null>>
    ) =>
      Result.isSuccess(current)
        ? Result.success(
            { ...current.value, setup: { ...current.value.setup, ...input } },
            { waiting: true }
          )
        : current,
    fn: runtime.fn(
      Effect.fn(function* (
        input: Partial<Record<keyof ProjectSetup, Date | null>>,
        get
      ) {
        const client = yield* ApiClient
        const updated = yield* client.projects.updateSetup({
          params: { orgSlug, slug },
          payload: input
        })
        get.refresh(projectBaseAtom(key))
        return updated
      })
    )
  })
})

export const deleteProjectAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const client = yield* ApiClient
      yield* client.projects.delete({ params: { orgSlug, slug } })
      get.refresh(projectBaseAtom(key))
      get.refresh(projectsListBaseAtom(orgSlug))
      yield* Reactivity.invalidate(["tickets", orgSlug, slug])
    })
  )
})

// --- Members --------------------------------------------------------------

export const addMemberAtom = Atom.family((key: string) => {
  const { orgSlug, slug } = splitProjectKey(key)
  return runtime.fn(
    Effect.fn(function* (
      input: { email: string; role: "admin" | "member" },
      get
    ) {
      const client = yield* ApiClient
      const updated = yield* client.projects.addMember({
        params: { orgSlug, slug },
        payload: input
      })
      get.refresh(projectBaseAtom(key))
      return updated
    })
  )
})

export const memberKey = (orgSlug: string, slug: string, userId: string) =>
  `${orgSlug}/${slug}/${userId}`

const splitMemberKey = (
  key: string
): { orgSlug: string; slug: string; userId: string } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    userId: parts.slice(2).join("/")
  }
}

export const updateMemberAtom = Atom.family((key: string) => {
  const { orgSlug, slug, userId } = splitMemberKey(key)
  return runtime.fn(
    Effect.fn(function* (input: { role: "admin" | "member" }, get) {
      const client = yield* ApiClient
      const updated = yield* client.projects.updateMember({
        params: { orgSlug, slug, userId },
        payload: input
      })
      get.refresh(projectBaseAtom(projectKey(orgSlug, slug)))
      return updated
    })
  )
})

export const removeMemberAtom = Atom.family((key: string) => {
  const { orgSlug, slug, userId } = splitMemberKey(key)
  return runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const client = yield* ApiClient
      yield* client.projects.removeMember({ params: { orgSlug, slug, userId } })
      get.refresh(projectBaseAtom(projectKey(orgSlug, slug)))
    })
  )
})

export const pendingMemberKey = (
  orgSlug: string,
  slug: string,
  invitationId: string
) => `${orgSlug}/${slug}/${invitationId}`

const splitPendingMemberKey = (
  key: string
): { orgSlug: string; slug: string; invitationId: string } => {
  const parts = key.split("/")
  return {
    orgSlug: parts[0],
    slug: parts[1],
    invitationId: parts.slice(2).join("/")
  }
}

export const cancelPendingMemberAtom = Atom.family((key: string) => {
  const { orgSlug, slug, invitationId } = splitPendingMemberKey(key)
  return runtime.fn(
    Effect.fn(function* (_input: void, get) {
      const client = yield* ApiClient
      const updated = yield* client.projects.cancelPendingMember({
        params: { orgSlug, slug, invitationId }
      })
      get.refresh(projectBaseAtom(projectKey(orgSlug, slug)))
      return updated
    })
  )
})

export const createProjectAtom = Atom.family((orgSlug: string) =>
  runtime.fn(
    Effect.fn(function* (input: { name: string; key: string }, get) {
      const client = yield* ApiClient
      const key = yield* Schema.decodeUnknownEffect(CreatableProjectKey)(
        input.key
      )
      const project = yield* client.projects.create({
        params: { orgSlug },
        payload: { name: input.name, key }
      })
      get.refresh(projectBaseAtom(projectKey(orgSlug, project.slug)))
      get.refresh(projectsListBaseAtom(orgSlug))
      yield* Reactivity.invalidate(["tickets", orgSlug, project.slug])
      return project
    })
  )
)

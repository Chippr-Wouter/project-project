import * as Atom from "effect/unstable/reactivity/Atom"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import * as Result from "effect/unstable/reactivity/AsyncResult"
import { Unauthorized } from "@projectproject/shared"
import { logoutAtom, meAtom } from "@/atoms/auth"

export function createSessionCache<
  Router extends { cancelMatches: () => void }
>(createRouter: (registry: Registry.AtomRegistry) => Router) {
  const listeners = new Set<() => void>()
  let identity: string | null | undefined
  let disposed = false
  let generation = 0
  const makeSession = (me?: Atom.Type<typeof meAtom>) => {
    const registry = Registry.make({
      initialValues: me ? [[meAtom, me]] : undefined
    })
    return {
      registry,
      router: createRouter(registry),
      ready: me !== undefined,
      generation: generation++
    }
  }
  let session = makeSession()
  let stopWatching = () => {}
  const notify = () => listeners.forEach((listener) => listener())

  const replace = (
    me: Atom.Type<typeof meAtom>,
    nextIdentity: string | null
  ) => {
    stopWatching()
    session.router.cancelMatches()
    session.registry.dispose()
    identity = nextIdentity
    session = makeSession(me)
    watch()
    notify()
  }

  const watch = () => {
    const { registry } = session
    const stopIdentity = registry.subscribe(meAtom, (me) => {
      if (disposed || registry !== session.registry) return
      const nextIdentity = Result.matchWithError(me, {
        onInitial: () => undefined,
        onSuccess: ({ value }) => value.id,
        onError: () => null,
        onDefect: () => undefined
      })
      if (
        session.ready &&
        nextIdentity !== undefined &&
        identity !== nextIdentity
      ) {
        replace(me, nextIdentity)
        return
      }
      if (nextIdentity !== undefined) identity = nextIdentity
      if (!session.ready && !Result.isInitial(me)) {
        session = { ...session, ready: true }
        notify()
      }
    })
    const stopLogout = registry.subscribe(logoutAtom, (result) => {
      if (
        !disposed &&
        registry === session.registry &&
        Result.isSuccess(result) &&
        !result.waiting
      ) {
        replace(Result.fail(new Unauthorized()), null)
      }
    })
    stopWatching = () => {
      stopIdentity()
      stopLogout()
    }
    registry.get(meAtom)
  }

  watch()

  return {
    getSnapshot: () => session,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    refreshIdentity: () => {
      if (!disposed) session.registry.refresh(meAtom)
    },
    dispose: () => {
      disposed = true
      stopWatching()
      session.router.cancelMatches()
      session.registry.dispose()
      listeners.clear()
    }
  }
}

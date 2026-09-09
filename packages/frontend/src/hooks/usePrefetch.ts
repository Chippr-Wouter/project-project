import * as Atom from "effect/unstable/reactivity/Atom"
import { RegistryContext } from "@effect/atom-react"
import { useCallback, useContext, useEffect, useRef } from "react"

const HOVER_INTENT_MS = 120

export function usePrefetch(getAtoms: () => Array<Atom.Atom<unknown>>) {
  const registry = useContext(RegistryContext)
  const disposers = useRef<Array<() => void>>([])
  const pending = useRef<number | null>(null)

  const mount = useCallback(() => {
    if (disposers.current.length > 0) return
    disposers.current = getAtoms().map((atom) => registry.mount(atom))
  }, [registry, getAtoms])

  const stop = useCallback(() => {
    if (pending.current !== null) {
      window.clearTimeout(pending.current)
      pending.current = null
    }
    for (const dispose of disposers.current) dispose()
    disposers.current = []
  }, [])

  const start = useCallback(() => {
    if (pending.current !== null || disposers.current.length > 0) return
    pending.current = window.setTimeout(() => {
      pending.current = null
      mount()
    }, HOVER_INTENT_MS)
  }, [mount])

  useEffect(() => stop, [stop])

  return {
    onPointerEnter: start,
    onFocus: mount,
    onPointerLeave: stop,
    onBlur: stop
  }
}

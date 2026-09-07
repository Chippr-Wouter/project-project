import * as Atom from "effect/unstable/reactivity/Atom"
import { RegistryContext } from "@effect/atom-react"
import { useCallback, useContext, useEffect, useRef } from "react"

export function usePrefetch(getAtoms: () => Array<Atom.Atom<unknown>>) {
  const registry = useContext(RegistryContext)
  const disposers = useRef<Array<() => void>>([])

  const stop = useCallback(() => {
    for (const dispose of disposers.current) dispose()
    disposers.current = []
  }, [])

  const start = useCallback(() => {
    if (disposers.current.length > 0) return
    disposers.current = getAtoms().map((atom) => registry.mount(atom))
  }, [registry, getAtoms])

  useEffect(() => stop, [stop])

  return {
    onPointerEnter: start,
    onFocus: start,
    onPointerLeave: stop,
    onBlur: stop
  }
}

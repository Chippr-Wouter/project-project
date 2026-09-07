import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { useCallback, useEffect, useRef, useState } from "react"

function readFromStorage<
  S extends Schema.ConstraintDecoder<unknown> &
    Schema.ConstraintEncoder<unknown>
>(key: string, schema: S, initial: S["Type"]): S["Type"] {
  if (typeof window === "undefined") return initial
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return initial
  }
  if (raw === null) return initial
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return initial
  }
  const decoded = Schema.decodeUnknownResult(schema)(parsed)
  return Result.isSuccess(decoded) ? decoded.success : initial
}

export function useLocalStorageState<
  S extends Schema.ConstraintDecoder<unknown> &
    Schema.ConstraintEncoder<unknown>
>(
  key: string,
  schema: S,
  initial: S["Type"]
): readonly [S["Type"], (next: S["Type"]) => void] {
  const schemaRef = useRef(schema)
  schemaRef.current = schema
  const initialRef = useRef(initial)
  initialRef.current = initial

  const [value, setValue] = useState<S["Type"]>(() =>
    readFromStorage(key, schema, initial)
  )

  useEffect(() => {
    setValue(readFromStorage(key, schemaRef.current, initialRef.current))
  }, [key])

  const write = useCallback(
    (next: S["Type"]) => {
      setValue(next)
      if (typeof window === "undefined") return
      try {
        const encoded = Schema.encodeSync(schema)(next)
        window.localStorage.setItem(key, JSON.stringify(encoded))
      } catch {
        return
      }
    },
    [key, schema]
  )

  return [value, write] as const
}

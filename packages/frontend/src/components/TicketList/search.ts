import { useState } from "react"
import { useDebouncer } from "@tanstack/react-pacer"

export const MIN_SEARCH_CHARS = 3

export function effectiveTicketSearch(draft: string) {
  return draft.length >= MIN_SEARCH_CHARS ? draft : undefined
}

type SearchDraft = {
  readonly draft: string
  readonly query: string | undefined
  readonly submitted: { readonly query: string | undefined } | null
  readonly revision: number
}

export function useTicketSearch(
  query: string | undefined,
  onCommit: (query: string | undefined) => void
) {
  const [state, setState] = useState<SearchDraft>({
    draft: query ?? "",
    query,
    submitted: null,
    revision: 0
  })

  if (state.query !== query) {
    const ownUpdate =
      state.submitted?.query === query && state.submitted !== null
    setState({
      draft: ownUpdate ? state.draft : (query ?? ""),
      query,
      submitted: null,
      revision: ownUpdate ? state.revision : state.revision + 1
    })
  }

  const commit = (draft: string) => {
    const nextQuery = effectiveTicketSearch(draft)
    if (nextQuery === query) return
    setState((current) => ({ ...current, submitted: { query: nextQuery } }))
    onCommit(nextQuery)
  }

  const debouncer = useDebouncer(
    (input: { draft: string; revision: number }) => {
      if (input.revision === state.revision && input.draft === state.draft) {
        commit(input.draft)
      }
    },
    { wait: 200 }
  )

  const change = (draft: string) => {
    setState((current) => ({ ...current, draft }))
    debouncer.cancel()
    if (effectiveTicketSearch(draft) !== query) {
      debouncer.maybeExecute({ draft, revision: state.revision })
    }
  }

  const reset = () => {
    debouncer.cancel()
    setState((current) => ({
      ...current,
      draft: "",
      submitted: { query: undefined }
    }))
  }

  const clear = () => {
    reset()
    commit("")
  }

  const flush = () => {
    debouncer.cancel()
    commit(state.draft)
  }

  return { draft: state.draft, change, clear, flush, reset }
}

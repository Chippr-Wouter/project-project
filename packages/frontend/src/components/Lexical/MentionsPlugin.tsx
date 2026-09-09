import { RegistryContext } from "@effect/atom-react"
import * as Registry from "effect/unstable/reactivity/AtomRegistry"
import {
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX
} from "react"
import { createPortal } from "react-dom"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import {
  TextNode,
  $getSelection,
  $isRangeSelection,
  $isElementNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalNode
} from "lexical"
import * as Effect from "effect/Effect"
import { AppLayer } from "@/runtime"
import {
  type MentionCandidate,
  type MentionProvider,
  mentionProviders,
  providerForTrigger
} from "@/mentions/registry"
import { useMentionScope } from "@/mentions/scope"
import { $createMentionNode, $isMentionNode } from "./MentionNode"

class MentionMenuOption extends MenuOption {
  constructor(
    public readonly provider: MentionProvider,
    public readonly candidate: MentionCandidate
  ) {
    super(`${provider.type}:${candidate.id}`)
  }
}

const TRIGGERS = mentionProviders.map((p) => p.trigger).join("")

export function MentionsPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext()
  const scope = useMentionScope()
  const registry = useContext(RegistryContext)
  const [queryString, setQueryString] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState<MentionProvider | null>(
    null
  )
  const [results, setResults] = useState<{
    provider: MentionProvider
    query: string
    scope: typeof scope
    candidates: ReadonlyArray<MentionCandidate>
  } | null>(null)

  const checkForTriggerMatch = useCallback((text: string) => {
    for (let i = text.length - 1; i >= 0; i--) {
      const ch = text[i]
      if (TRIGGERS.includes(ch)) {
        const prev = i === 0 ? " " : text[i - 1]
        if (/\s/.test(prev)) {
          const provider = providerForTrigger(ch)
          if (!provider) return null
          const matchString = text.slice(i + 1)
          if (/\s/.test(matchString)) return null
          setActiveProvider(provider)
          return {
            leadOffset: i,
            matchingString: matchString,
            replaceableString: text.slice(i)
          }
        }
      }
    }
    return null
  }, [])

  useEffect(() => {
    if (!activeProvider || queryString === null) {
      setResults(null)
      return
    }
    const controller = new AbortController()
    setResults(null)
    Effect.runPromise(
      Effect.gen(function* () {
        if (queryString.length > 0) yield* Effect.sleep("200 millis")
        return yield* activeProvider.search(
          queryString,
          scope ?? { orgSlug: "", slug: "" }
        )
      }).pipe(
        Effect.provideService(Registry.AtomRegistry, registry),
        Effect.provide(AppLayer)
      ),
      { signal: controller.signal }
    ).then(
      (r) => {
        if (!controller.signal.aborted)
          setResults({
            provider: activeProvider,
            query: queryString,
            scope,
            candidates: r.slice(0, 8)
          })
      },
      () => {
        if (!controller.signal.aborted) setResults(null)
      }
    )
    return () => {
      controller.abort()
    }
  }, [activeProvider, queryString, scope, registry])

  const options = useMemo(
    () =>
      results &&
      results.provider === activeProvider &&
      results.query === queryString &&
      results.scope === scope
        ? results.candidates.map(
            (c) => new MentionMenuOption(results.provider, c)
          )
        : [],
    [activeProvider, queryString, scope, results]
  )

  const onSelectOption = useCallback(
    (
      selectedOption: MentionMenuOption,
      nodeToReplace: TextNode | null,
      closeMenu: () => void
    ) => {
      editor.update(() => {
        const sel = $getSelection()
        if (!$isRangeSelection(sel)) return
        const node = $createMentionNode(
          selectedOption.provider.type,
          selectedOption.candidate.id,
          selectedOption.candidate.label
        )
        if (nodeToReplace) nodeToReplace.replace(node)
        else sel.insertNodes([node])
        node.selectNext()
        closeMenu()
      })
    },
    [editor]
  )

  useEffect(() => {
    const adjacentNode = (
      direction: "previous" | "next"
    ): LexicalNode | null => {
      const sel = $getSelection()
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null
      const anchor = sel.anchor
      const node = anchor.getNode()
      if (anchor.type === "text") {
        if (direction === "previous") {
          return anchor.offset === 0 ? node.getPreviousSibling() : null
        }
        return anchor.offset === node.getTextContentSize()
          ? node.getNextSibling()
          : null
      }
      if (!$isElementNode(node)) return null
      const idx = direction === "previous" ? anchor.offset - 1 : anchor.offset
      return node.getChildAtIndex(idx)
    }
    const removeMention = (target: LexicalNode | null) => {
      if (!$isMentionNode(target)) return false
      target.remove()
      return true
    }
    const removeBackspace = editor.registerCommand<KeyboardEvent | null>(
      KEY_BACKSPACE_COMMAND,
      (e) => {
        const removed = removeMention(adjacentNode("previous"))
        if (removed) e?.preventDefault()
        return removed
      },
      COMMAND_PRIORITY_LOW
    )
    const removeDelete = editor.registerCommand<KeyboardEvent | null>(
      KEY_DELETE_COMMAND,
      (e) => {
        const removed = removeMention(adjacentNode("next"))
        if (removed) e?.preventDefault()
        return removed
      },
      COMMAND_PRIORITY_LOW
    )
    return () => {
      removeBackspace()
      removeDelete()
    }
  }, [editor])

  return (
    <LexicalTypeaheadMenuPlugin<MentionMenuOption>
      onQueryChange={setQueryString}
      onSelectOption={onSelectOption}
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp }) => {
        if (!anchorRef.current || options.length === 0) return null
        return createPortal(
          <div className="bg-popover text-popover-foreground border-border z-50 mt-1 w-72 overflow-hidden rounded-md border shadow-md">
            {options.map((opt, i) => (
              <button
                key={opt.key}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectOptionAndCleanUp(opt)
                }}
                className={`hover:bg-accent block w-full px-3 py-1.5 text-left text-sm transition-colors ${
                  i === selectedIndex ? "bg-accent" : ""
                }`}
              >
                {opt.provider.renderRow(opt.candidate)}
              </button>
            ))}
          </div>,
          anchorRef.current
        )
      }}
    />
  )
}

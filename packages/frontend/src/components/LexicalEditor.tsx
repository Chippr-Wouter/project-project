import { useEffect, useRef, useState } from "react"
import * as Effect from "effect/Effect"
import { useDebouncer } from "@tanstack/react-pacer"
import {
  configExtension,
  defineExtension,
  $createParagraphNode,
  $getRoot,
  type ElementNode,
  type LexicalEditor as LexicalEditorType
} from "lexical"
import { LexicalExtensionComposer } from "@lexical/react/LexicalExtensionComposer"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  CHECK_LIST,
  TRANSFORMERS
} from "@lexical/markdown"
import type { TicketId } from "@projectproject/shared"
import { RichTextExtension } from "@lexical/rich-text"
import { HistoryExtension } from "@lexical/history"
import {
  CheckListExtension,
  ListExtension,
  $isListItemNode
} from "@lexical/list"
import {
  AutoLinkExtension,
  ClickableLinkExtension,
  LinkExtension,
  createLinkMatcherWithRegExp,
  formatUrl
} from "@lexical/link"
import { CodeExtension, registerCodeHighlighting } from "@lexical/code"
import {
  AutoFocusExtension,
  HorizontalRuleExtension,
  TabIndentationExtension
} from "@lexical/extension"
import { MentionExtension } from "./Lexical/MentionExtension"
import { MentionsPlugin } from "./Lexical/MentionsPlugin"
import { MENTION_TRANSFORMER } from "./Lexical/mentionTransformer"
import { AttachmentExtension } from "./Lexical/AttachmentExtension"
import { AttachmentsPlugin } from "./Lexical/AttachmentsPlugin"
import { ATTACHMENT_TRANSFORMER } from "./Lexical/attachmentTransformer"
import {
  HORIZONTAL_RULE,
  HorizontalRuleEnterExtension
} from "./Lexical/horizontalRuleTransformer"
import { ChecklistClickExtension } from "./Lexical/checklistClickExtension"
import { ListTabExtension } from "./Lexical/listTabExtension"
import { registerMarkdownPaste } from "./Lexical/markdownPaste"
import "@/lib/prism-langs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

export const MARKDOWN_TRANSFORMERS = [
  MENTION_TRANSFORMER,
  CHECK_LIST,
  HORIZONTAL_RULE,
  ...TRANSFORMERS
]

const ATTACHMENT_MARKDOWN_TRANSFORMERS = [
  ATTACHMENT_TRANSFORMER,
  ...MARKDOWN_TRANSFORMERS
]

export const transformersForAttachments = (
  attachments: AttachmentsTarget | undefined
) =>
  attachments === undefined
    ? MARKDOWN_TRANSFORMERS
    : ATTACHMENT_MARKDOWN_TRANSFORMERS

export const attachmentsForDescription = (input: {
  readonly orgSlug: string
  readonly slug: string
  readonly ticketId: TicketId
  readonly storageActive: boolean
}): AttachmentsTarget => ({
  orgSlug: input.orgSlug,
  slug: input.slug,
  ticketId: input.ticketId,
  uploadsEnabled: input.storageActive
})

const URL_MATCHER = createLinkMatcherWithRegExp(
  /(?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,;:!?]/i,
  formatUrl
)

const EMAIL_MATCHER = createLinkMatcherWithRegExp(
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  formatUrl
)

export const AUTO_LINK_MATCHERS = [URL_MATCHER, EMAIL_MATCHER]

const lexicalTheme = {
  paragraph: "lexical-paragraph",
  heading: {
    h1: "lexical-h1",
    h2: "lexical-h2",
    h3: "lexical-h3",
    h4: "lexical-h4",
    h5: "lexical-h5",
    h6: "lexical-h6"
  },
  quote: "lexical-quote",
  list: {
    ul: "lexical-ul",
    ol: "lexical-ol",
    listitem: "lexical-li",
    checklist: "lexical-checklist",
    listitemChecked: "lexical-li-checked",
    listitemUnchecked: "lexical-li-unchecked",
    nested: {
      listitem: "lexical-li-nested"
    }
  },
  hr: "lexical-hr",
  link: "lexical-link",
  text: {
    bold: "lexical-bold",
    italic: "lexical-italic",
    code: "lexical-inline-code",
    strikethrough: "lexical-strike",
    underline: "lexical-underline"
  },
  code: "lexical-code",
  codeHighlight: {
    atrule: "token atrule",
    attr: "token attr-name",
    boolean: "token boolean",
    builtin: "token builtin",
    cdata: "token cdata",
    char: "token char",
    "class-name": "token class-name",
    comment: "token comment",
    constant: "token constant",
    deleted: "token deleted",
    doctype: "token doctype",
    entity: "token entity",
    function: "token function",
    important: "token important",
    inserted: "token inserted",
    keyword: "token keyword",
    namespace: "token namespace",
    number: "token number",
    operator: "token operator",
    prolog: "token prolog",
    property: "token property",
    punctuation: "token punctuation",
    regex: "token regex",
    selector: "token selector",
    string: "token string",
    symbol: "token symbol",
    tag: "token tag",
    url: "token url",
    variable: "token variable",
    "deleted-sign": "token deleted-sign",
    "deleted-arrow": "token deleted-arrow",
    "inserted-sign": "token inserted-sign",
    "inserted-arrow": "token inserted-arrow",
    unchanged: "token unchanged",
    diff: "token diff",
    coord: "token coord",
    line: "token line",
    prefix: "token prefix"
  }
}

const CodeHighlightExtension = defineExtension({
  name: "@projectproject/code-highlight",
  dependencies: [CodeExtension],
  register: (editor: LexicalEditorType) => registerCodeHighlighting(editor)
})

const $canIndentInsideLists = (node: ElementNode) => $isListItemNode(node)

export type SaveStatus = "idle" | "dirty" | "saving" | "saved"

export interface AttachmentsTarget {
  readonly orgSlug: string
  readonly slug: string
  readonly ticketId: TicketId
  readonly uploadsEnabled: boolean
}

export interface LexicalEditorProps {
  markdown: string
  onChange: (markdown: string) => Promise<void> | void
  onDraftChange?: (markdown: string) => void
  onStatusChange?: (status: SaveStatus) => void
  debounceMs?: number
  className?: string
  placeholder?: string
  autoFocus?: boolean
  compact?: boolean
  attachments?: AttachmentsTarget
}

export function nextMarkdownChange(
  currentMarkdown: string,
  nextMarkdown: string
) {
  if (nextMarkdown === currentMarkdown) return null
  return nextMarkdown
}

export function createCoalescedSaveQueue<A>(options: {
  readonly save: (value: A) => Promise<void> | void
  readonly schedule: () => void
  readonly onStatus: (status: SaveStatus) => void
  readonly onError: (error: unknown) => void
}) {
  let pending: A | null = null
  let inflight = false
  let unmounted = false

  const flush = (notify = true): Promise<void> | undefined => {
    if (inflight || pending === null) return undefined
    const next = pending
    pending = null
    inflight = true
    if (notify) options.onStatus("saving")
    let retainedFailure = false
    let saving: Promise<void>
    try {
      saving = Promise.resolve(options.save(next))
    } catch (error) {
      saving = Promise.reject(error)
    }
    saving = saving
      .then(() => {
        if (notify && pending === null) options.onStatus("saved")
      })
      .catch((error: unknown) => {
        if (pending === null) {
          pending = next
          retainedFailure = true
        }
        options.onError(error)
        if (notify) options.onStatus("dirty")
      })
      .finally(() => {
        inflight = false
        if (pending !== null && !retainedFailure) {
          if (unmounted) void flush(false)
          else options.schedule()
        }
      })
    return saving
  }

  return {
    enqueue: (value: A) => {
      pending = value
    },
    flush,
    unmount: () => {
      unmounted = true
      void flush(false)
    }
  }
}

function LinkBlurActivationPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(
    () =>
      editor.registerRootListener((root) => {
        if (!root) return
        const handlePointerDown = (event: PointerEvent) => {
          if (event.button > 1) return
          if (!(event.target instanceof Element)) return
          const link = event.target.closest("a.lexical-link")
          if (!link || !root.contains(link)) return
          if (root.contains(document.activeElement)) return
          event.preventDefault()
        }
        root.addEventListener("pointerdown", handlePointerDown)
        return () => {
          root.removeEventListener("pointerdown", handlePointerDown)
        }
      }),
    [editor]
  )

  return null
}

export function LexicalEditor({
  markdown,
  onChange,
  onDraftChange,
  onStatusChange,
  debounceMs = 600,
  className,
  placeholder = m.editor_placeholder(),
  autoFocus = false,
  compact = false,
  attachments
}: LexicalEditorProps) {
  const [transformers] = useState(() => transformersForAttachments(attachments))
  const [attachmentNodesEnabled] = useState(() => attachments !== undefined)
  const [extension] = useState(() => {
    const initialMarkdown = markdown
    const initialAutoFocus = autoFocus
    return defineExtension({
      name: "@projectproject/body-editor",
      namespace: "ProjectBody",
      theme: lexicalTheme,
      register: (editor: LexicalEditorType) =>
        registerMarkdownPaste(editor, transformers),
      onError: (error) => {
        Effect.runFork(Effect.logError("[Lexical]", error))
      },
      $initialEditorState: () => {
        $convertFromMarkdownString(initialMarkdown, transformers)
        const root = $getRoot()
        const last = root.getLastChild()
        if (!last || last.getType() !== "paragraph") {
          root.append($createParagraphNode())
        }
      },
      dependencies: [
        RichTextExtension,
        HistoryExtension,
        ListExtension,
        CheckListExtension,
        ChecklistClickExtension,
        ListTabExtension,
        LinkExtension,
        configExtension(ClickableLinkExtension, {
          newTab: true,
          disabled: false
        }),
        configExtension(AutoLinkExtension, {
          matchers: AUTO_LINK_MATCHERS
        }),
        CodeExtension,
        CodeHighlightExtension,
        HorizontalRuleExtension,
        HorizontalRuleEnterExtension,
        MentionExtension,
        ...(attachmentNodesEnabled ? [AttachmentExtension] : []),
        configExtension(TabIndentationExtension, {
          $canIndent: $canIndentInsideLists,
          maxIndent: 4
        }),
        configExtension(AutoFocusExtension, {
          defaultSelection: "rootEnd",
          disabled: !initialAutoFocus
        })
      ]
    })
  })

  const liveRef = useRef(markdown)
  const onChangeRef = useRef(onChange)
  const onStatusChangeRef = useRef(onStatusChange)
  const scheduleRef = useRef<() => void>(() => {})
  onChangeRef.current = onChange
  onStatusChangeRef.current = onStatusChange

  function setStatus(s: SaveStatus) {
    onStatusChangeRef.current?.(s)
  }

  const saveQueueRef = useRef<ReturnType<
    typeof createCoalescedSaveQueue<string>
  > | null>(null)
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createCoalescedSaveQueue({
      save: (next) => onChangeRef.current(next),
      schedule: () => scheduleRef.current(),
      onStatus: setStatus,
      onError: (error) => {
        Effect.runFork(Effect.logError("[LexicalEditor] save failed", error))
      }
    })
  }
  const saveQueue = saveQueueRef.current

  const saveDebouncer = useDebouncer(() => saveQueue.flush(), {
    wait: debounceMs,
    onUnmount: (d) => {
      d.cancel()
      saveQueue.unmount()
    }
  })
  scheduleRef.current = () => saveDebouncer.maybeExecute()

  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const editable = wrapper.querySelector<HTMLElement>(
      '[contenteditable="true"]'
    )
    if (!editable) return
    editable.spellcheck = false
    const focusIn = () => {
      editable.spellcheck = true
    }
    const focusOut = () => {
      editable.spellcheck = false
    }
    wrapper.addEventListener("focusin", focusIn)
    wrapper.addEventListener("focusout", focusOut)
    return () => {
      wrapper.removeEventListener("focusin", focusIn)
      wrapper.removeEventListener("focusout", focusOut)
    }
  }, [])

  const [contentEditable] = useState(() => (
    <div className="relative">
      <ContentEditable
        className={cn(
          "lexical-content outline-none",
          compact ? "min-h-[1.5rem]" : "min-h-[8rem]"
        )}
        aria-placeholder={placeholder}
        placeholder={
          <div className="pointer-events-none absolute left-0 top-0 select-none text-muted-foreground">
            {placeholder}
          </div>
        }
      />
    </div>
  ))

  return (
    <div ref={wrapperRef} className={cn("group/editing prose-md", className)}>
      <LexicalExtensionComposer
        extension={extension}
        contentEditable={contentEditable}
      >
        <MentionsPlugin />
        {attachments !== undefined && attachments.uploadsEnabled ? (
          <AttachmentsPlugin
            orgSlug={attachments.orgSlug}
            slug={attachments.slug}
            ticketId={attachments.ticketId}
          />
        ) : null}
        <LinkBlurActivationPlugin />
        <MarkdownShortcutPlugin transformers={transformers} />
        <OnChangePlugin
          onChange={(editorState) => {
            editorState.read(() => {
              const next = $convertToMarkdownString(transformers)
              const changed = nextMarkdownChange(liveRef.current, next)
              if (changed === null) return
              liveRef.current = changed
              onDraftChange?.(next)
              saveQueue.enqueue(changed)
              setStatus("dirty")
              scheduleRef.current()
            })
          }}
          ignoreSelectionChange
        />
      </LexicalExtensionComposer>
    </div>
  )
}

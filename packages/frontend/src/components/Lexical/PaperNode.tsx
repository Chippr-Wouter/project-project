import {
  $applyNodeReplacement,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread
} from "lexical"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection"
import { mergeRegister } from "@lexical/utils"
import { ExternalLink, Pencil, Trash2 } from "lucide-react"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode
} from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"

export interface PaperPayload {
  readonly url: string
  readonly label: string
}

export type SerializedPaperNode = Spread<
  {
    url: string
    label: string
  },
  SerializedLexicalNode
>

const INTERACTIVE_SELECTOR = "a, button, input, [data-paper-action]"

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null

const CHIP =
  "mx-0.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 align-baseline text-xs transition-[color,background-color,border-color,transform] duration-100 active:scale-[0.97] group-focus-within/editing:hover:bg-accent/40"

const OVERLAY_REVEAL =
  "invisible opacity-0 transition-opacity group-focus-within/editing:visible group-hover/hitbox:opacity-100 group-focus-within/hitbox:opacity-100"

export class PaperNode extends DecoratorNode<ReactElement> {
  __url: string
  __label: string

  static getType(): string {
    return "paper"
  }

  static clone(node: PaperNode): PaperNode {
    return new PaperNode({ url: node.__url, label: node.__label }, node.__key)
  }

  constructor(payload: PaperPayload, key?: NodeKey) {
    super(key)
    this.__url = payload.url
    this.__label = payload.label
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.setAttribute("data-paper-design", "true")
    span.style.display = "inline-block"
    span.style.verticalAlign = "middle"
    span.style.maxWidth = "100%"
    return span
  }

  updateDOM(): false {
    return false
  }

  isInline(): boolean {
    return true
  }

  getTextContent(): string {
    return this.__url
  }

  getUrl(): string {
    return this.getLatest().__url
  }

  getLabel(): string {
    return this.getLatest().__label
  }

  setLabel(label: string): void {
    this.getWritable().__label = label
  }

  exportJSON(): SerializedPaperNode {
    return {
      ...super.exportJSON(),
      type: "paper",
      version: 1,
      url: this.__url,
      label: this.__label
    }
  }

  static importJSON(serialized: SerializedPaperNode): PaperNode {
    return $createPaperNode({
      url: serialized.url,
      label: serialized.label
    })
  }

  decorate(): ReactElement {
    return (
      <PaperSelectable
        nodeKey={this.getKey()}
        url={this.__url}
        label={this.__label}
      />
    )
  }
}

function PaperSelectable({
  nodeKey,
  url,
  label
}: {
  nodeKey: NodeKey
  url: string
  label: string
}) {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey)
  const resolvedLabel = label.trim() || m.editor_paper_default_name()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(resolvedLabel)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const remove = useCallback(() => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove()
    })
  }, [editor, nodeKey])

  const commitLabel = useCallback(() => {
    const next = draft.trim() || m.editor_paper_default_name()
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if ($isPaperNode(node)) node.setLabel(next)
    })
    setEditing(false)
  }, [draft, editor, nodeKey])

  useEffect(() => {
    const onDelete = (event: globalThis.KeyboardEvent) => {
      if (!isSelected || !$isNodeSelection($getSelection())) return false
      event.preventDefault()
      remove()
      return true
    }

    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const element = editor.getElementByKey(nodeKey)
          const target = event.target
          if (!element || !(target instanceof Node)) return false
          if (!element.contains(target)) return false
          if (isInteractiveTarget(target)) return false
          event.preventDefault()
          clearSelection()
          setSelected(true)
          return true
        },
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        () => {
          if (!isSelected) return false
          clearSelection()
          return true
        },
        COMMAND_PRIORITY_LOW
      )
    )
  }, [editor, nodeKey, isSelected, setSelected, clearSelection, remove])

  const selectOnPointer = (event: ReactMouseEvent<HTMLElement>) => {
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()
    const root = editor.getRootElement()
    if (root && document.activeElement !== root) {
      root.focus({ preventScroll: true })
    }
    clearSelection()
    setSelected(true)
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === "Enter") {
      event.preventDefault()
      commitLabel()
    } else if (event.key === "Escape") {
      event.preventDefault()
      setDraft(resolvedLabel)
      setEditing(false)
    }
  }

  const startEditing = () => {
    clearSelection()
    setSelected(true)
    setDraft(resolvedLabel)
    setEditing(true)
  }

  return (
    <span
      className="inline-block max-w-full align-middle"
      onMouseDown={selectOnPointer}
    >
      <span
        data-paper-selected={isSelected ? "true" : undefined}
        className={cn(
          "group/hitbox relative my-0.5 inline-block max-w-full rounded-md align-middle transition-shadow duration-150 hover:z-20 focus-within:z-20",
          isSelected
            ? "z-20 ring-2 ring-ring ring-offset-2 ring-offset-background"
            : "z-0 ring-0 ring-transparent"
        )}
      >
        {editing ? (
          <Input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={handleInputKeyDown}
            onMouseDown={(event) => event.stopPropagation()}
            maxLength={200}
            aria-label={m.editor_paper_name_input_label()}
            className="max-w-[50vw]"
            style={{
              width: `${Math.min(Math.max(draft.length + 1, 12), 40)}ch`
            }}
          />
        ) : (
          <span className={CHIP}>
            <PaperGlyph className="size-3 shrink-0" />
            <span className="truncate">{resolvedLabel}</span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              data-paper-action="open"
              aria-label={m.editor_paper_open()}
              title={m.editor_paper_open()}
              onMouseDown={(event) => event.stopPropagation()}
              className="shrink-0 rounded text-muted-foreground transition-colors duration-100 hover:text-foreground active:[&>svg]:scale-[0.97] [&>svg]:transition-transform [&>svg]:duration-100"
            >
              <ExternalLink
                strokeWidth={1.75}
                className="size-3"
                aria-hidden="true"
              />
            </a>
          </span>
        )}
        <OverlayAction
          slot="absolute right-full -top-1 mr-1 flex h-8 items-center before:absolute before:inset-y-0 before:-inset-x-3 before:content-['']"
          label={m.editor_paper_remove()}
          variant="overlay-destructive"
          onClick={remove}
        >
          <Trash2 strokeWidth={1.75} />
        </OverlayAction>
        <OverlayAction
          slot="absolute left-full -top-1 ml-1 flex h-8 items-center before:absolute before:inset-y-0 before:-inset-x-3 before:content-['']"
          label={m.editor_paper_edit_name()}
          variant="overlay"
          onClick={startEditing}
        >
          <Pencil strokeWidth={1.75} />
        </OverlayAction>
      </span>
    </span>
  )
}

function PaperGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect
        width="16"
        height="16"
        rx="3.5"
        className="fill-[oklch(0.738562_0.104396_258.136)]"
      />
      <path
        className="fill-[oklch(0.969316_0.00397_106.473)]"
        d="M5 3.5h7.5v6H9.5V5H5z"
      />
      <path
        className="fill-[oklch(0.969316_0.00397_106.473)]"
        d="M3.5 5H5v4.5h4.5v3H3.5z"
      />
    </svg>
  )
}

function OverlayAction({
  slot,
  label,
  variant,
  onClick,
  children
}: {
  slot: string
  label: string
  variant: "overlay" | "overlay-destructive"
  onClick: () => void
  children: ReactNode
}) {
  return (
    <span className={slot}>
      <Button
        variant={variant}
        size="icon-sm"
        aria-label={label}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={OVERLAY_REVEAL}
      >
        {children}
      </Button>
    </span>
  )
}

export function $createPaperNode(payload: PaperPayload): PaperNode {
  return $applyNodeReplacement(new PaperNode(payload))
}

export function $isPaperNode(
  node: LexicalNode | null | undefined
): node is PaperNode {
  return node instanceof PaperNode
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate()
  })
}

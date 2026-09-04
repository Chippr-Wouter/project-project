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
import { ExternalLink, Maximize2, Minimize2, Trash2 } from "lucide-react"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode
} from "react"
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion
} from "motion/react"
import {
  parseFigmaUrl,
  type FigmaDensity,
  type FigmaRef
} from "@projectproject/shared"
import { Button } from "@/components/ui/button"
import { standardEaseCss, transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import { FigmaChip } from "./FigmaChip"
import { FigmaEmbed } from "./FigmaEmbed"

export interface FigmaPayload {
  readonly url: string
  readonly label: string
  readonly ref: FigmaRef | null
  readonly density?: FigmaDensity
}

export type SerializedFigmaNode = Spread<
  {
    url: string
    label: string
    density: FigmaDensity
  },
  SerializedLexicalNode
>

const INTERACTIVE_SELECTOR = "a, button, iframe, [data-figma-action]"

const isInteractiveTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null

const OVERLAY_REVEAL =
  "opacity-0 transition-opacity group-hover/hitbox:opacity-100 group-focus-within/hitbox:opacity-100"

const OVERLAY_SLOT = "absolute flex h-8 items-center"

const CONTENT_MORPH = { ...transitions.morph, opacity: transitions.fade }

const morphSizes = new WeakMap<HTMLElement, { width: number; height: number }>()

export class FigmaNode extends DecoratorNode<ReactElement> {
  __url: string
  __label: string
  __ref: FigmaRef | null
  __density: FigmaDensity

  static getType(): string {
    return "figma"
  }

  static clone(node: FigmaNode): FigmaNode {
    return new FigmaNode(
      {
        url: node.__url,
        label: node.__label,
        ref: node.__ref,
        density: node.__density
      },
      node.__key
    )
  }

  constructor(payload: FigmaPayload, key?: NodeKey) {
    super(key)
    this.__url = payload.url
    this.__label = payload.label
    this.__ref = payload.ref
    this.__density = payload.density ?? "rich"
  }

  createDOM(): HTMLElement {
    const span = document.createElement("span")
    span.setAttribute("data-figma-kind", this.__ref?.kind ?? "unknown")
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

  getRef(): FigmaRef | null {
    return this.getLatest().__ref
  }

  getDensity(): FigmaDensity {
    return this.getLatest().__density
  }

  setDensity(density: FigmaDensity): void {
    const writable = this.getWritable()
    writable.__density = density
  }

  exportJSON(): SerializedFigmaNode {
    return {
      ...super.exportJSON(),
      type: "figma",
      version: 1,
      url: this.__url,
      label: this.__label,
      density: this.__density
    }
  }

  static importJSON(serialized: SerializedFigmaNode): FigmaNode {
    return $createFigmaNode({
      url: serialized.url,
      label: serialized.label,
      ref: parseFigmaUrl(serialized.url),
      density: serialized.density ?? "rich"
    })
  }

  decorate(): ReactElement {
    return (
      <FigmaSelectable
        nodeKey={this.getKey()}
        url={this.__url}
        label={this.__label}
        reference={this.__ref}
        density={this.__density}
      />
    )
  }
}

function FigmaSelectable({
  nodeKey,
  url,
  label,
  reference,
  density
}: {
  nodeKey: NodeKey
  url: string
  label: string
  reference: FigmaRef | null
  density: FigmaDensity
}) {
  const [editor] = useLexicalComposerContext()
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey)

  const remove = useCallback(() => {
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove()
    })
  }, [editor, nodeKey])

  const wrapperRef = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const reduceMotion = useReducedMotion() ?? false

  useLayoutEffect(() => {
    const element = wrapperRef.current
    if (element === null) return undefined
    const previous = morphSizes.get(element)
    let animation: Animation | undefined

    const unpin = () => {
      element.style.removeProperty("width")
      element.style.removeProperty("height")
      element.style.removeProperty("overflow")
      const content = contentRef.current
      content?.style.removeProperty("width")
      content?.style.removeProperty("height")
    }

    unpin()
    const rect = element.getBoundingClientRect()
    const next = { width: rect.width, height: rect.height }
    morphSizes.set(element, next)

    const changed =
      previous !== undefined &&
      (Math.abs(previous.width - next.width) >= 0.5 ||
        Math.abs(previous.height - next.height) >= 0.5)

    if (changed && !reduceMotion) {
      const content = contentRef.current
      if (content !== null) {
        content.style.width = `${next.width}px`
        content.style.height = `${next.height}px`
      }
      animation = element.animate(
        [
          { width: `${previous.width}px`, height: `${previous.height}px` },
          { width: `${next.width}px`, height: `${next.height}px` }
        ],
        { duration: transitions.morph.duration * 1000, easing: standardEaseCss }
      )
      animation.addEventListener("finish", unpin, { once: true })
    }

    return () => {
      animation?.cancel()
      unpin()
    }
  }, [density, reduceMotion])

  const toggleDensity = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey)
      if (!$isFigmaNode(node)) return
      node.setDensity(node.getDensity() === "compact" ? "rich" : "compact")
    })
  }, [editor, nodeKey])

  useEffect(() => {
    const onDelete = (event: KeyboardEvent) => {
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

  const compact = density === "compact"
  const morphId = `figma-${nodeKey}`
  const overlaySlot = cn(
    OVERLAY_SLOT,
    compact
      ? "-top-1 before:absolute before:inset-y-0 before:-inset-x-3 before:content-['']"
      : "-top-2"
  )

  return (
    <span
      className="inline-block max-w-full align-middle"
      onMouseDown={selectOnPointer}
    >
      <span
        ref={wrapperRef}
        data-figma-selected={isSelected ? "true" : undefined}
        className={cn(
          "group/hitbox relative inline-block max-w-full align-middle ring-offset-2 ring-offset-background transition-shadow duration-150 hover:z-20 focus-within:z-20",
          compact ? "my-0.5 rounded-md" : "my-2 rounded-xl",
          isSelected ? "z-20 ring-2 ring-ring" : "z-0 ring-0 ring-transparent"
        )}
      >
        <LayoutGroup id={morphId}>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              ref={contentRef}
              data-figma-content="true"
              key={compact ? "compact" : "expanded"}
              layoutId={morphId}
              transition={CONTENT_MORPH}
              className="block"
            >
              {compact ? (
                <FigmaChip
                  reference={reference}
                  label={label}
                  morphId={morphId}
                />
              ) : (
                <FigmaEmbed
                  reference={reference}
                  url={url}
                  label={label}
                  morphId={morphId}
                />
              )}
            </motion.span>
          </AnimatePresence>
          <OverlayAction
            morphId={`${morphId}-remove`}
            slot={cn(overlaySlot, compact ? "right-full mr-1" : "-left-2")}
            label={m.figma_embed_remove()}
            variant="overlay-destructive"
            onClick={remove}
          >
            <Trash2 strokeWidth={1.75} />
          </OverlayAction>
          {reference === null || compact ? null : (
            <OverlayAction
              morphId={`${morphId}-open`}
              slot={cn(OVERLAY_SLOT, "-right-2 -bottom-2")}
              label={m.figma_embed_open_in_figma()}
              variant="overlay"
              href={url}
            >
              <ExternalLink strokeWidth={1.75} />
            </OverlayAction>
          )}
          {reference === null ? null : (
            <OverlayAction
              morphId={`${morphId}-density`}
              slot={cn(overlaySlot, compact ? "left-full ml-1" : "-right-2")}
              label={
                compact ? m.figma_embed_expand() : m.figma_embed_collapse()
              }
              variant="overlay"
              onClick={toggleDensity}
            >
              {compact ? (
                <Maximize2 strokeWidth={1.75} />
              ) : (
                <Minimize2 strokeWidth={1.75} />
              )}
            </OverlayAction>
          )}
        </LayoutGroup>
      </span>
    </span>
  )
}

function OverlayAction({
  morphId,
  slot,
  label,
  variant,
  onClick,
  href,
  children
}: {
  morphId: string
  slot: string
  label: string
  variant: "overlay" | "overlay-destructive"
  onClick?: () => void
  href?: string
  children: ReactNode
}) {
  return (
    <motion.span
      layoutId={morphId}
      layout="position"
      transition={transitions.morph}
      className={slot}
    >
      <Button
        variant={variant}
        size="icon-sm"
        aria-label={label}
        title={label}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={OVERLAY_REVEAL}
        render={
          href === undefined ? undefined : (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              data-figma-action="open"
            />
          )
        }
      >
        {children}
      </Button>
    </motion.span>
  )
}

export function $createFigmaNode(payload: FigmaPayload): FigmaNode {
  return $applyNodeReplacement(new FigmaNode(payload))
}

export function $isFigmaNode(
  node: LexicalNode | null | undefined
): node is FigmaNode {
  return node instanceof FigmaNode
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate()
  })
}

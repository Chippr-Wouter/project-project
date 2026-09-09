import {
  createContext,
  use,
  useCallback,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode
} from "react"
import { useRender } from "@base-ui/react/use-render"
import { mergeProps } from "@base-ui/react/merge-props"

type EditSession = { initial: string; draft: string }
type EditableContextValue = {
  value: string
  session: EditSession | null
  pending: boolean
  error: string | null
  errorId: string
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  previewRef: (element: HTMLButtonElement | null) => void
  start: () => void
  change: (draft: string) => void
  cancel: () => void
  commit: (restoreFocus: boolean) => Promise<void>
}
const EditableContext = createContext<EditableContextValue | null>(null)
function useEditable() {
  const context = use(EditableContext)
  if (!context)
    throw new Error("Editable parts must render inside Editable.Root")
  return context
}

type EditableRootProps = {
  value: string
  onCommit: (value: string) => Promise<boolean>
  pending?: boolean
  error?: string | null
  children: ReactNode
}
function Root({
  value,
  onCommit,
  pending = false,
  error = null,
  children
}: EditableRootProps) {
  const [session, setSession] = useState<EditSession | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const committing = useRef(false)
  const active = useRef(false)
  const restoreFocus = useRef(false)
  const errorId = useId()
  const previewRef = useCallback((element: HTMLButtonElement | null) => {
    if (element && restoreFocus.current) {
      restoreFocus.current = false
      element.focus()
    }
  }, [])

  function close(focus: boolean) {
    active.current = false
    restoreFocus.current = focus
    setSession(null)
  }

  async function commit(focus: boolean) {
    if (!session || !active.current || committing.current || pending) return
    if (session.draft === session.initial) {
      close(focus)
      return
    }
    committing.current = true
    try {
      if (await onCommit(session.draft)) {
        close(focus && document.activeElement === inputRef.current)
      }
    } finally {
      committing.current = false
    }
  }

  return (
    <EditableContext
      value={{
        value,
        session,
        pending,
        error,
        errorId,
        inputRef,
        previewRef,
        commit,
        start: () => {
          if (pending) return
          active.current = true
          setSession({ initial: value, draft: value })
        },
        change: (draft) =>
          setSession((current) => current && { ...current, draft }),
        cancel: () => {
          if (!committing.current && !pending) close(true)
        }
      }}
    >
      {children}
    </EditableContext>
  )
}

function Preview({ ref, children, ...props }: ComponentProps<"button">) {
  const { session, value, pending, start, previewRef } = useEditable()
  return useRender({
    defaultTagName: "button",
    state: { pending },
    enabled: session === null,
    ref: [ref ?? null, previewRef],
    props: mergeProps<"button">(
      {
        type: "button",
        disabled: pending,
        "aria-busy": pending,
        onClick: (event) => {
          if (!event.defaultPrevented) start()
        },
        children: children ?? value
      },
      props
    )
  })
}

type EditableInputProps = Omit<
  ComponentProps<"textarea">,
  "value" | "defaultValue"
> & {
  render?: useRender.RenderProp
}
function Input({ render, ref, ...props }: EditableInputProps) {
  const { session, pending, error, errorId, inputRef, change, commit, cancel } =
    useEditable()
  const focusAtEnd = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])
  return useRender({
    defaultTagName: "textarea",
    state: { pending },
    render,
    enabled: session !== null,
    ref: [ref ?? null, inputRef, focusAtEnd],
    props: mergeProps<"textarea">(
      {
        value: session?.draft ?? "",
        readOnly: pending,
        "aria-busy": pending,
        "aria-invalid": !!error || undefined,
        "aria-describedby": error ? errorId : undefined,
        onChange: (event) => change(event.currentTarget.value),
        onBlur: (event) => {
          if (!event.defaultPrevented) void commit(false)
        },
        onKeyDown: (event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            void commit(true)
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancel()
          }
        }
      },
      props
    )
  })
}

function ErrorMessage(props: ComponentProps<"span">) {
  const { session, error, errorId } = useEditable()
  if (!session || !error) return null
  return (
    <span {...props} id={errorId} role="alert">
      {error}
    </span>
  )
}

export const Editable = { Root, Preview, Input, Error: ErrorMessage }

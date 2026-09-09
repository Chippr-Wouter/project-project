import { forwardRef, type FormEvent, type ReactNode, type Ref } from "react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput
} from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

export type TicketCreatorShellProps = {
  formProps?: { "data-active"?: true }
  inputRef: Ref<HTMLInputElement>
  value: string
  onValueChange: (next: string) => void
  onPointerEnter?: () => void
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  expanded: boolean
  placeholder: string
  ariaLabel: string
  disabled?: boolean
  maxLength?: number
  trailing?: ReactNode
  leadingAddons: ReadonlyArray<ReactNode>
  belowInput?: ReactNode
}

function _TicketCreatorShell(
  props: TicketCreatorShellProps,
  _ref: Ref<HTMLDivElement>
) {
  const {
    formProps,
    inputRef,
    value,
    onValueChange,
    onPointerEnter,
    onFocus,
    onBlur,
    onKeyDown,
    onSubmit,
    expanded,
    placeholder,
    ariaLabel,
    disabled,
    maxLength,
    trailing,
    leadingAddons,
    belowInput
  } = props

  return (
    <form onSubmit={onSubmit} {...formProps} className="relative">
      <InputGroup
        className={cn(
          "transition-[padding] duration-200 ease-out",
          expanded && "pl-2"
        )}
      >
        {leadingAddons.map((addon, i) => (
          <InputGroupAddon key={i} className="w-auto">
            {addon}
          </InputGroupAddon>
        ))}
        <InputGroupInput
          ref={inputRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onPointerEnter={onPointerEnter}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          disabled={disabled}
          maxLength={maxLength}
        />
        {trailing}
      </InputGroup>
      {belowInput}
    </form>
  )
}

export const TicketCreatorShell = forwardRef(_TicketCreatorShell)

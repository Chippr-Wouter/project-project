import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { Link } from "@tanstack/react-router"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { orgDetailAtom } from "@/atoms/orgs"
import { orgStorageAtom } from "@/atoms/storage"
import {
  ticketBodyDraftAtom,
  ticketKey,
  updateTicketAtom
} from "@/atoms/tickets"
import {
  attachmentsForDescription,
  LexicalEditor,
  type SaveStatus
} from "@/components/LexicalEditor"
import { AttachmentAvailabilityProvider } from "@/components/Lexical/attachmentAvailability"
import { cn } from "@/lib/utils"
import { MentionScopeProvider } from "@/mentions/scope"
import { m } from "@/paraglide/messages"
import type { Member, TicketDetail } from "@projectproject/shared"

const COLLAPSE_THRESHOLD_VH = 0.5
const DESCRIPTION_REGION_ID = "ticket-description-region"

export function DescriptionField({
  orgSlug,
  slug,
  ticket,
  members,
  autoFocus,
  onStatusChange
}: {
  orgSlug: string
  slug: string
  ticket: TicketDetail
  members: ReadonlyArray<Member>
  autoFocus: boolean
  onStatusChange: (status: SaveStatus) => void
}) {
  const tKey = ticketKey(orgSlug, slug, ticket.id)
  const update = useAtomSet(updateTicketAtom(tKey), { mode: "promiseExit" })
  const updateState = useAtomValue(updateTicketAtom(tKey))
  const bodyDraft = useAtomValue(ticketBodyDraftAtom(tKey))
  const setBodyDraft = useAtomSet(ticketBodyDraftAtom(tKey))
  const storageResult = useAtomValue(orgStorageAtom(orgSlug))
  const orgResult = useAtomValue(orgDetailAtom(orgSlug))
  const storageActive =
    Result.isSuccess(storageResult) && storageResult.value.status === "active"
  const canConnectStorage =
    Result.isSuccess(orgResult) &&
    (orgResult.value.role === "owner" || orgResult.value.role === "admin")

  useEffect(() => {
    if (
      !updateState.waiting &&
      bodyDraft !== null &&
      ticket.body === bodyDraft
    ) {
      setBodyDraft(null)
    }
  }, [bodyDraft, setBodyDraft, ticket.body, updateState.waiting])

  const wrapperRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [collapsedPx, setCollapsedPx] = useState(0)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState(false)

  useLayoutEffect(() => {
    const inner = contentRef.current
    if (!inner) return

    let frame = 0
    let lastVh = 0
    let lastH = 0
    const measure = () => {
      frame = 0
      const vh = window.innerHeight
      const h = inner.getBoundingClientRect().height
      if (vh === lastVh && Math.abs(h - lastH) < 0.5) return
      lastVh = vh
      lastH = h
      setCollapsedPx(Math.round(vh * COLLAPSE_THRESHOLD_VH))
      setOverflows(h > vh * COLLAPSE_THRESHOLD_VH)
    }
    const schedule = () => {
      if (frame !== 0) return
      frame = requestAnimationFrame(measure)
    }

    measure()
    const ro = new ResizeObserver(schedule)
    ro.observe(inner)
    window.addEventListener("resize", schedule)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener("resize", schedule)
    }
  }, [])

  const collapsed = overflows && !expanded && !focused

  return (
    <div>
      <div
        ref={wrapperRef}
        id={DESCRIPTION_REGION_ID}
        className={cn(
          "relative rounded-lg border border-transparent px-3 py-2 transition-colors duration-150 focus-within:border-border focus-within:bg-background",
          collapsed ? "overflow-hidden" : "overflow-visible"
        )}
        style={{
          maxHeight:
            collapsed && collapsedPx > 0 ? `${collapsedPx}px` : undefined
        }}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false)
        }}
      >
        <div ref={contentRef}>
          <MentionScopeProvider scope={{ orgSlug, slug, members }}>
            <AttachmentAvailabilityProvider missing={ticket.missingAttachments}>
              <LexicalEditor
                key={`${slug}/${ticket.id}`}
                markdown={bodyDraft ?? ticket.body}
                onDraftChange={setBodyDraft}
                onChange={async (next) => {
                  const exit = await update({ body: next })
                  if (Exit.isFailure(exit)) throw Cause.squash(exit.cause)
                }}
                onStatusChange={onStatusChange}
                autoFocus={autoFocus}
                attachments={attachmentsForDescription({
                  orgSlug,
                  slug,
                  ticketId: ticket.id,
                  storageActive
                })}
              />
            </AttachmentAvailabilityProvider>
          </MentionScopeProvider>
        </div>
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-muted transition-opacity duration-200",
            collapsed ? "opacity-100" : "opacity-0"
          )}
        />
      </div>
      {!storageActive && canConnectStorage && (
        <div className="mt-2 px-3">
          <Link
            to="/orgs/$orgSlug/settings/storage"
            params={{ orgSlug }}
            className="text-xs text-muted-foreground underline-offset-2 transition-colors duration-100 hover:text-foreground hover:underline"
          >
            {m.editor_attachment_connect_prompt()}
          </Link>
        </div>
      )}
      {overflows && (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded(collapsed)}
            aria-expanded={!collapsed}
            aria-controls={DESCRIPTION_REGION_ID}
            className="rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-all duration-100 hover:bg-accent/40 hover:text-foreground active:scale-[0.97]"
          >
            {collapsed
              ? m.tickets_page_read_more()
              : m.tickets_page_show_less()}
          </button>
        </div>
      )}
    </div>
  )
}

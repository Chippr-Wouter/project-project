import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useState } from "react"
import { motion, AnimatePresence } from "motion/react"
import * as Exit from "effect/Exit"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { Button } from "@/components/ui/button"
import { LexicalEditor } from "@/components/LexicalEditor"
import { commentsKey, createCommentAtom } from "@/atoms/comments"
import { transitions } from "@/lib/springs"
import { m } from "@/paraglide/messages"
import type { TicketId } from "@projectproject/shared"

export function CommentComposer({
  orgSlug,
  slug,
  ticketId
}: {
  orgSlug: string
  slug: string
  ticketId: TicketId
}) {
  const [body, setBody] = useState("")
  const [expanded, setExpanded] = useState(false)
  const [editorVersion, setEditorVersion] = useState(0)
  const key = commentsKey(orgSlug, slug, ticketId)
  const createAtom = createCommentAtom(key)
  const create = useAtomSet(createAtom, { mode: "promiseExit" })
  const createState = useAtomValue(createAtom)
  const submitting = createState.waiting
  const error = Result.isFailure(createState)
    ? m.comments_composer_failed()
    : null

  const submit = async () => {
    if (!body.trim() || submitting) return
    const exit = await create({ body })
    if (Exit.isSuccess(exit)) {
      setBody("")
      setEditorVersion((v) => v + 1)
      setExpanded(false)
    }
  }

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    if (!body.trim()) setExpanded(false)
  }

  return (
    <motion.div
      onFocus={() => setExpanded(true)}
      onBlur={handleBlur}
      animate={{
        paddingTop: expanded ? 12 : 6,
        paddingBottom: expanded ? 12 : 6
      }}
      transition={transitions.layout}
      className="border-border bg-background rounded-md border px-3"
    >
      <LexicalEditor
        key={editorVersion}
        markdown={body}
        onChange={(md) => setBody(md)}
        placeholder={m.comments_composer_placeholder()}
        compact
      />
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="actions"
            initial={{ opacity: 0, height: 0, marginTop: 0 }}
            animate={{ opacity: 1, height: "auto", marginTop: 8 }}
            exit={{ opacity: 0, height: 0, marginTop: 0 }}
            transition={transitions.presence}
            className="overflow-hidden"
          >
            {error && <p className="text-destructive mb-2 text-sm">{error}</p>}
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={submit}
                disabled={submitting || !body.trim()}
                className={submitting ? "animate-pulse" : undefined}
              >
                {m.comments_composer_submit()}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

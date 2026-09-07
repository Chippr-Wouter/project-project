import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as DateTime from "effect/DateTime"
import { useState, type FormEvent } from "react"
import type { GroupId, TicketId, WorkTypeOption } from "@projectproject/shared"
import { logTimeAtom } from "@/atoms/timeTracking"
import { projectKey } from "@/atoms/projects"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { WorkTypeSelect } from "@/components/time/WorkTypeSelect"
import * as m from "@/paraglide/messages"

export const parseDurationToSeconds = (input: string): number | null => {
  const trimmed = input.trim().toLowerCase()
  if (trimmed.length === 0) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const minutes = Number.parseFloat(trimmed)
    return minutes > 0 ? Math.round(minutes * 60) : null
  }
  const pattern = /(\d+(?:\.\d+)?)\s*(h|m)/g
  let total = 0
  let matched = false
  let match: RegExpExecArray | null
  while ((match = pattern.exec(trimmed)) !== null) {
    matched = true
    const amount = Number.parseFloat(match[1])
    total += match[2] === "h" ? amount * 3600 : amount * 60
  }
  return matched && total > 0 ? Math.round(total) : null
}

const todayIso = () => {
  const now = DateTime.toDate(DateTime.nowUnsafe())
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

export function LogTimeForm({
  orgSlug,
  slug,
  ticketId,
  groupId,
  options,
  defaultWorkType,
  onDone
}: {
  orgSlug: string
  slug: string
  ticketId: TicketId | null
  groupId?: GroupId | null
  options: ReadonlyArray<WorkTypeOption>
  defaultWorkType: string
  onDone?: () => void
}) {
  const projKey = projectKey(orgSlug, slug)
  const logTime = useAtomSet(logTimeAtom(projKey), { mode: "promiseExit" })
  const logState = useAtomValue(logTimeAtom(projKey))
  const submitting = logState.waiting
  const [workType, setWorkType] = useState(defaultWorkType)
  const [duration, setDuration] = useState("")
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState("")
  const [invalid, setInvalid] = useState(false)
  const error =
    Result.isFailure(logState) || invalid ? m.time_log_error() : null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const seconds = parseDurationToSeconds(duration)
    if (seconds === null) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    const exit = await logTime({
      workTypeKey: workType,
      seconds,
      date,
      comment: note.trim() ? note.trim() : undefined,
      ticketId,
      groupId: ticketId ? undefined : (groupId ?? undefined)
    })
    if (exit._tag === "Success") {
      setDuration("")
      setNote("")
      onDone?.()
    }
  }

  return (
    <form className="grid grid-cols-1 gap-3 sm:grid-cols-2" onSubmit={submit}>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {m.time_log_duration_label()}
        <Input
          autoFocus
          value={duration}
          placeholder={m.time_log_duration_placeholder()}
          onChange={(event) => setDuration(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {m.time_log_date_label()}
        <Input
          type="date"
          value={date}
          className="min-w-0"
          onChange={(event) => setDate(event.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
        {m.time_work_type_label()}
        <WorkTypeSelect
          value={workType}
          onChange={setWorkType}
          options={options}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground sm:col-span-2">
        {m.time_log_note_label()}
        <Input
          value={note}
          placeholder={m.time_log_note_placeholder()}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="flex items-center gap-1.5 sm:col-span-2">
        <Button type="submit" size="sm" loading={submitting}>
          {m.time_log_submit()}
        </Button>
        {onDone ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDone}
            disabled={submitting}
          >
            {m.time_cancel()}
          </Button>
        ) : null}
      </div>
      {invalid ? (
        <p role="alert" className="text-xs text-destructive sm:col-span-2">
          {m.time_log_duration_invalid()}
        </p>
      ) : error ? (
        <p role="alert" className="text-xs text-destructive sm:col-span-2">
          {error}
        </p>
      ) : null}
    </form>
  )
}

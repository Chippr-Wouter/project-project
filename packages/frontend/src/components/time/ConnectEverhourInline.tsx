import * as Result from "effect/unstable/reactivity/AsyncResult"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useState, type FormEvent } from "react"
import { connectEverhourProfileAtom } from "@/atoms/everhour"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import * as m from "@/paraglide/messages"

export function ConnectEverhourInline({
  onConnected
}: {
  onConnected?: () => void
}) {
  const [apiKey, setApiKey] = useState("")
  const connect = useAtomSet(connectEverhourProfileAtom, { mode: "promise" })
  const connectState = useAtomValue(connectEverhourProfileAtom)
  const waiting = connectState.waiting
  const error = Result.isFailure(connectState) ? m.time_connect_error() : null

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    const profile = await connect({ apiKey: trimmed })
    setApiKey("")
    if (profile.connected) onConnected?.()
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{m.time_connect_prompt()}</p>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <Input
          type="password"
          value={apiKey}
          autoComplete="off"
          placeholder={m.time_connect_key_placeholder()}
          aria-label={m.time_connect_key_placeholder()}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <Button type="submit" loading={waiting} disabled={!apiKey.trim()}>
          {m.time_connect_cta()}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

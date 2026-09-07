import * as Result from "effect/unstable/reactivity/AsyncResult"
// Connected agents card on the profile page.
//
// Lists OAuth clients (typically MCP agents) that have completed an
// authorization with the user's account and lets them revoke any of them.
// Schema comes from /api/oauth-applications; see shared/schemas/OAuthApplication.
//
// Below the list, a small disclosure offers ready-to-paste snippets for the
// common MCP clients (Claude Code, Gemini CLI, Codex CLI). The URL is derived
// from the current window origin — single-origin homelab deploys work without
// edits; dev/split-origin setups can swap the host before pasting.

import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ChevronRight, KeyRound } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card"
import { CodeSnippet } from "@/components/ui/code-snippet"
import {
  oauthApplicationsAtom,
  revokeOAuthApplicationAtom
} from "@/atoms/oauthApplications"
import { m } from "@/paraglide/messages"
import { getLocale } from "@/paraglide/runtime"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import type { OAuthApplication } from "@projectproject/shared"

export function ConnectedAgentsSection() {
  const applications = useAtomValue(oauthApplicationsAtom)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.profile_section_connected_agents_title()}</CardTitle>
        <CardDescription>
          {m.profile_section_connected_agents_description()}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {Result.isSuccess(applications) ? (
          applications.value.length === 0 ? (
            <p className="text-muted-foreground">
              {m.profile_connected_agents_empty()}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-background">
              {applications.value.map((app) => (
                <li key={app.id}>
                  <AgentRow app={app} />
                </li>
              ))}
            </ul>
          )
        ) : null}

        <ConnectMcpDisclosure />
      </CardContent>
    </Card>
  )
}

function AgentRow({ app }: { app: OAuthApplication }) {
  const revoke = useAtomSet(revokeOAuthApplicationAtom(app.id))
  const revokeState = useAtomValue(revokeOAuthApplicationAtom(app.id))
  const busy = revokeState.waiting
  const locale = getLocale()

  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <KeyRound className="size-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-sm font-medium">{app.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{app.clientId}</span>
          <span className="mx-1.5">·</span>
          {m.profile_connected_agents_connected_at({
            date: app.createdAt.toLocaleDateString(locale)
          })}
          <span className="mx-1.5">·</span>
          {app.lastUsedAt
            ? m.profile_connected_agents_last_used_at({
                date: app.lastUsedAt.toLocaleDateString(locale)
              })
            : m.profile_connected_agents_never_used()}
        </div>
      </div>
      <Button
        variant="tertiary"
        size="sm"
        disabled={busy}
        onClick={() => revoke()}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        {m.profile_connected_agents_revoke()}
      </Button>
    </div>
  )
}

type McpProvider = {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly language: "bash" | "json" | "toml"
  readonly buildSnippet: (mcpUrl: string) => string
}

function ConnectMcpDisclosure() {
  const mcpUrl = useMemo(() => {
    if (typeof window === "undefined")
      return "https://your-instance.example.com/mcp"
    return `${window.location.origin}/mcp`
  }, [])
  const providers = useMemo<ReadonlyArray<McpProvider>>(
    () => [
      {
        id: "claude",
        label: m.profile_connect_mcp_claude_label(),
        description: m.profile_connect_mcp_claude_description(),
        language: "bash",
        buildSnippet: (url) =>
          `claude mcp add --transport http projectproject ${url}`
      },
      {
        id: "gemini",
        label: m.profile_connect_mcp_gemini_label(),
        description: m.profile_connect_mcp_gemini_description(),
        language: "json",
        buildSnippet: (url) =>
          JSON.stringify(
            { mcpServers: { projectproject: { httpUrl: url } } },
            null,
            2
          )
      },
      {
        id: "codex",
        label: m.profile_connect_mcp_codex_label(),
        description: m.profile_connect_mcp_codex_description(),
        language: "toml",
        buildSnippet: (url) =>
          [
            "[mcp_servers.projectproject]",
            'command = "npx"',
            `args = ["-y", "mcp-remote", "${url}"]`
          ].join("\n")
      }
    ],
    []
  )
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <section>
      <h3 className="mb-2 text-sm font-medium text-foreground">
        {m.profile_connect_mcp_title()}
      </h3>
      <div className="divide-y divide-border rounded-xl border border-border bg-background">
        {providers.map((provider) => (
          <ProviderItem
            key={provider.id}
            provider={provider}
            mcpUrl={mcpUrl}
            open={openId === provider.id}
            onToggle={() =>
              setOpenId((current) =>
                current === provider.id ? null : provider.id
              )
            }
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        {m.profile_connect_mcp_caveat()}
      </p>
    </section>
  )
}

function ProviderItem({
  provider,
  mcpUrl,
  open,
  onToggle
}: {
  provider: McpProvider
  mcpUrl: string
  open: boolean
  onToggle: () => void
}) {
  const reduceMotion = useReducedMotion()
  const snippet = useMemo(
    () => provider.buildSnippet(mcpUrl),
    [provider, mcpUrl]
  )

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-muted/60 active:bg-muted"
      >
        <ChevronRight
          className={cn(
            "size-3.5 text-muted-foreground transition-transform duration-150",
            open && "rotate-90"
          )}
          strokeWidth={2}
        />
        <span>{provider.label}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
            transition={transitions.presence}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-3 pb-3">
              <p className="text-xs text-muted-foreground">
                {provider.description}
              </p>
              <CodeSnippet code={snippet} language={provider.language} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

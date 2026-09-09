import { RegistryContext, useAtomRefresh } from "@effect/atom-react"
import { useContext, useEffect } from "react"
import { projectGitStatesBaseAtom } from "@/atoms/github"
import { projectKey } from "@/atoms/projects"

const POLL_INTERVAL_MS = 60_000

export function useProjectGitStatePolling(
  orgSlug: string,
  slug: string,
  enabled: boolean
) {
  const registry = useContext(RegistryContext)
  const atom = projectGitStatesBaseAtom(projectKey(orgSlug, slug))
  const refresh = useAtomRefresh(atom)

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return

    let scheduled: number | undefined
    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible" || scheduled !== undefined)
        return
      scheduled = window.setTimeout(() => {
        scheduled = undefined
        if (
          document.visibilityState === "visible" &&
          !registry.get(atom).waiting
        )
          refresh()
      }, 50)
    }

    const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS)
    document.addEventListener("visibilitychange", refreshIfVisible)
    window.addEventListener("focus", refreshIfVisible)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(scheduled)
      document.removeEventListener("visibilitychange", refreshIfVisible)
      window.removeEventListener("focus", refreshIfVisible)
    }
  }, [enabled, refresh, registry, atom])
}

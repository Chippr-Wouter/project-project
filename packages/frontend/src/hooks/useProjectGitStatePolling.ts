import { useAtomRefresh } from "@effect/atom-react"
import { useEffect } from "react"
import { projectGitStatesBaseAtom } from "@/atoms/github"
import { projectKey } from "@/atoms/projects"

const POLL_INTERVAL_MS = 60_000

export function useProjectGitStatePolling(
  orgSlug: string,
  slug: string,
  enabled: boolean
) {
  const refresh = useAtomRefresh(
    projectGitStatesBaseAtom(projectKey(orgSlug, slug))
  )

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }

    const interval = window.setInterval(refreshIfVisible, POLL_INTERVAL_MS)
    document.addEventListener("visibilitychange", refreshIfVisible)
    window.addEventListener("focus", refreshIfVisible)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", refreshIfVisible)
      window.removeEventListener("focus", refreshIfVisible)
    }
  }, [enabled, refresh])
}

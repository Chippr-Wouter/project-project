import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
import { useAtomValue } from "@effect/atom-react"
import type { ProjectBanner as Banner } from "@projectproject/shared"
import { projectBannerPreviewAtom, projectKey } from "@/atoms/projects"
import { bannerDefaults, bannerSource } from "./project-banner-presets"
import type { BannerPrototypeSettings } from "./ProjectBannerPrototypeShader"
import { m } from "@/paraglide/messages"

const ProjectBannerPrototypeShader = lazy(() =>
  import("./ProjectBannerPrototypeShader").then((module) => ({
    default: module.ProjectBannerPrototypeShader
  }))
)

export function ProjectBanner({
  orgSlug,
  slug,
  banner,
  waiting,
  variant = "header"
}: {
  orgSlug: string
  slug: string
  banner: Banner | null
  waiting?: boolean
  variant?: "header" | "card" | "row"
}) {
  const preview = useAtomValue(
    projectBannerPreviewAtom(projectKey(orgSlug, slug))
  )
  const source = preview ? preview.source : bannerSource(orgSlug, banner)
  const crop = preview?.crop ?? banner?.crop ?? bannerDefaults
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!source) return
    let cancelled = false
    let frame = 0
    let timer = 0
    const photo = new Image()
    photo.crossOrigin = "anonymous"
    photo.onload = () => {
      void photo
        .decode()
        .then(() => {
          if (cancelled) return
          frame = requestAnimationFrame(() => {
            timer = window.setTimeout(() => {
              if (!cancelled) setImage(photo)
            }, 0)
          })
        })
        .catch(() => undefined)
    }
    photo.src = source
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [source])
  if (
    !source ||
    !image ||
    (image.src !== source && image.getAttribute("src") !== source)
  )
    return null
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute -z-10 overflow-hidden rounded-t-[inherit] ${variant === "header" ? "-inset-x-6 -top-6" : "inset-x-0 top-0"} ${waiting ? "animate-pulse" : ""}`}
      style={{
        height:
          variant === "header"
            ? bannerDefaults.height
            : variant === "card"
              ? 120
              : "100%",
        opacity: bannerDefaults.overallOpacity
      }}
    >
      <Suspense fallback={null}>
        {variant === "header" ? (
          <ProjectBannerPrototypeShader
            image={image}
            settings={{ ...bannerDefaults, ...crop }}
            mode="mask"
            label={m.project_banner_settings_live_preview()}
          />
        ) : (
          <StaticBanner
            key={`${source}/${crop.x}/${crop.y}/${crop.zoom}/${variant}`}
            image={image}
            settings={{ ...bannerDefaults, ...crop }}
          />
        )}
      </Suspense>
    </div>
  )
}

function StaticBanner({
  image,
  settings
}: {
  image: HTMLImageElement
  settings: BannerPrototypeSettings
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [bitmap, setBitmap] = useState<{
    src: string
    width: number
    height: number
  } | null>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      const height = Math.round(entry.contentRect.height)
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height }
      )
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const capture = useCallback(
    (canvas: HTMLCanvasElement) => {
      if (
        canvas.width > 0 &&
        canvas.height > 0 &&
        size.width > 0 &&
        size.height > 0
      )
        setBitmap({ src: canvas.toDataURL("image/png"), ...size })
    },
    [size]
  )
  return (
    <div ref={ref} className="size-full">
      {bitmap &&
      bitmap.width === size.width &&
      bitmap.height === size.height ? (
        <img src={bitmap.src} alt="" className="block size-full" />
      ) : (
        size.width > 0 &&
        size.height > 0 && (
          <ProjectBannerPrototypeShader
            image={image}
            settings={settings}
            mode="mask"
            label={m.project_banner_settings_live_preview()}
            onRender={capture}
          />
        )
      )}
    </div>
  )
}

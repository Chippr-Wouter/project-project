import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult"
import * as Exit from "effect/Exit"
import {
  ATTACHMENT_MAX_BYTES,
  isRasterImageContentType,
  type ProjectBanner
} from "@projectproject/shared"
import {
  projectKey,
  updateProjectAtom,
  projectBannerPreviewAtom
} from "@/atoms/projects"
import { uploadProjectImageAtom } from "@/atoms/attachments"
import { orgStorageAtom, orgStorageBaseAtom } from "@/atoms/storage"
import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { ImagePlus, Trash2, Upload } from "lucide-react"
import { ErrorPage } from "@/components/ErrorPage"
import { Button } from "@/components/ui/button"
import { useShape } from "@/lib/shape-context"
import { transitions } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { m } from "@/paraglide/messages"
import {
  bannerDefaults,
  bannerPresets,
  bannerSource
} from "./project-banner-presets"
import {
  ProjectBannerPrototypeShader,
  type BannerPrototypeSettings
} from "./ProjectBannerPrototypeShader"

type BannerState = {
  source: string
  file?: File
  settings: BannerPrototypeSettings
  removed: boolean
}

const initialState: BannerState = {
  source: bannerPresets[0].src,
  settings: bannerDefaults,
  removed: false
}

export default function ProjectBannerSettings({
  orgSlug,
  slug,
  banner
}: {
  orgSlug: string
  slug: string
  banner: ProjectBanner | null
}) {
  const key = projectKey(orgSlug, slug)
  const update = useAtomSet(updateProjectAtom(key), { mode: "promiseExit" })
  const upload = useAtomSet(uploadProjectImageAtom(key), {
    mode: "promiseExit"
  })
  const updateState = useAtomValue(updateProjectAtom(key))
  const uploadState = useAtomValue(uploadProjectImageAtom(key))
  const storage = useAtomValue(orgStorageAtom(orgSlug))
  const retryStorage = useAtomRefresh(orgStorageBaseAtom(orgSlug))
  const storageAvailable =
    AsyncResult.isSuccess(storage) && storage.value.status === "active"
  const submitting = updateState.waiting || uploadState.waiting
  const setPreview = useAtomSet(projectBannerPreviewAtom(key))
  const applied: BannerState = {
    source: bannerSource(orgSlug, banner) ?? initialState.source,
    settings: { ...bannerDefaults, ...banner?.crop },
    removed: banner === null
  }

  const shape = useShape()
  const reduce = useReducedMotion() ?? false
  const [draft, setDraft] = useState(applied)
  const [editing, setEditing] = useState(false)
  const [contentHeight, setContentHeight] = useState<number | undefined>()
  const contentRef = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [error, setError] = useState(false)
  const objectUrls = useRef<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{
    x: number
    y: number
    cropX: number
    cropY: number
  } | null>(null)

  const live = editing ? draft : applied
  const imageReady =
    image?.src === live.source || image?.getAttribute("src") === live.source
  const preset = bannerPresets.find((entry) => entry.src === draft.source)

  useEffect(() => {
    let cancelled = false
    const photo = new Image()
    photo.addEventListener("load", () => {
      if (!cancelled) setImage(photo)
    })
    photo.addEventListener("error", () => {
      if (!cancelled) setError(true)
    })
    photo.crossOrigin = "anonymous"
    photo.src = live.source
    return () => {
      cancelled = true
    }
  }, [live.source])

  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url))
    },
    []
  )

  useEffect(() => {
    const content = contentRef.current
    if (!content) return undefined
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContentHeight(entry.contentRect.height)
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  const edit = (removed: boolean) => {
    setError(false)
    setDraft({ ...applied, removed })
    setEditing(true)
  }
  const cancel = () => {
    setError(false)
    setDraft(applied)
    setEditing(false)
  }
  const apply = async () => {
    const crop = {
      x: draft.settings.x,
      y: draft.settings.y,
      zoom: draft.settings.zoom
    }
    let next: ProjectBanner | null = null
    if (!draft.removed) {
      if (draft.file) {
        const uploaded = await upload({ file: draft.file })
        if (Exit.isFailure(uploaded)) return
        next = {
          type: "attachment",
          attachmentId: uploaded.value.id,
          crop
        }
      } else if (preset) {
        next = { type: "preset", preset: preset.id, crop }
      } else if (banner) next = { ...banner, crop }
    }
    const saved = await update({ banner: next })
    if (Exit.isSuccess(saved)) setEditing(false)
  }
  useEffect(() => {
    setPreview(
      editing
        ? { source: draft.removed ? null : draft.source, crop: draft.settings }
        : null
    )
    return () => setPreview(null)
  }, [editing, draft, setPreview])
  const setZoom = (zoom: number) =>
    setDraft((current) => ({
      ...current,
      settings: { ...current.settings, zoom }
    }))

  const morph = reduce ? { duration: 0 } : transitions.layout
  const fade = reduce ? { duration: 0 } : transitions.fade
  const fadeIn = reduce ? false : { opacity: 0 }
  const fadeOut = { opacity: 0 }

  return (
    <fieldset disabled={submitting} className="contents">
      <div
        aria-busy={submitting}
        className="relative flex w-full min-w-0 flex-col gap-2 sm:max-w-xl sm:flex-1"
      >
        <span className="text-xs text-muted-foreground">
          {m.project_banner_settings_label()}
        </span>
        <motion.div
          initial={false}
          animate={{
            height: contentHeight === undefined ? "auto" : contentHeight + 8
          }}
          transition={morph}
          className="-m-1 overflow-hidden p-1"
        >
          <div ref={contentRef} className="relative">
            <AnimatePresence initial={false} mode="popLayout">
              {editing ? (
                <motion.div
                  key="editor"
                  initial={fadeIn}
                  animate={{ opacity: 1 }}
                  exit={fadeOut}
                  transition={morph}
                  className="flex flex-col gap-3"
                >
                  <motion.div
                    transition={morph}
                    role="group"
                    tabIndex={0}
                    aria-label={m.project_banner_settings_crop()}
                    onKeyDown={(event) => {
                      if (draft.removed || !imageReady) return
                      const directions: Record<string, [number, number]> = {
                        ArrowLeft: [1, 0],
                        ArrowRight: [-1, 0],
                        ArrowUp: [0, 1],
                        ArrowDown: [0, -1]
                      }
                      const direction = directions[event.key]
                      if (!direction) return
                      event.preventDefault()
                      const step = event.shiftKey ? 0.1 : 0.01
                      setDraft((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          x: Math.max(
                            0,
                            Math.min(
                              1,
                              current.settings.x + direction[0] * step
                            )
                          ),
                          y: Math.max(
                            0,
                            Math.min(
                              1,
                              current.settings.y + direction[1] * step
                            )
                          )
                        }
                      }))
                    }}
                    className={cn(
                      "relative aspect-[3/1] w-full touch-none overflow-hidden bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      shape.bg,
                      image &&
                        !draft.removed &&
                        "cursor-grab active:cursor-grabbing"
                    )}
                    onPointerDown={(event) => {
                      if (!image || draft.removed) return
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragRef.current = {
                        x: event.clientX,
                        y: event.clientY,
                        cropX: draft.settings.x,
                        cropY: draft.settings.y
                      }
                    }}
                    onPointerMove={(event) => {
                      const drag = dragRef.current
                      if (!drag || !image) return
                      const rect = event.currentTarget.getBoundingClientRect()
                      const scale =
                        Math.max(
                          rect.width / image.naturalWidth,
                          rect.height / image.naturalHeight
                        ) * draft.settings.zoom
                      const overflowX = image.naturalWidth * scale - rect.width
                      const overflowY =
                        image.naturalHeight * scale - rect.height
                      setDraft((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          x:
                            overflowX > 0
                              ? Math.max(
                                  0,
                                  Math.min(
                                    1,
                                    drag.cropX -
                                      (event.clientX - drag.x) / overflowX
                                  )
                                )
                              : current.settings.x,
                          y:
                            overflowY > 0
                              ? Math.max(
                                  0,
                                  Math.min(
                                    1,
                                    drag.cropY -
                                      (event.clientY - drag.y) / overflowY
                                  )
                                )
                              : current.settings.y
                        }
                      }))
                    }}
                    onPointerUp={() => {
                      dragRef.current = null
                    }}
                    onPointerCancel={() => {
                      dragRef.current = null
                    }}
                    onLostPointerCapture={() => {
                      dragRef.current = null
                    }}
                  >
                    <AnimatePresence initial={false}>
                      {image && imageReady && !draft.removed ? (
                        <motion.div
                          key="crop"
                          initial={fadeIn}
                          animate={{ opacity: 1 }}
                          exit={fadeOut}
                          transition={fade}
                          className="absolute inset-0"
                        >
                          <ProjectBannerPrototypeShader
                            image={image}
                            settings={draft.settings}
                            mode="original"
                            label={m.project_banner_settings_crop()}
                          />
                        </motion.div>
                      ) : draft.removed ? (
                        <motion.span
                          key="empty"
                          initial={fadeIn}
                          animate={{ opacity: 1 }}
                          exit={fadeOut}
                          transition={fade}
                          className="absolute inset-0 grid place-items-center text-xs text-muted-foreground"
                        >
                          {m.project_banner_settings_empty()}
                        </motion.span>
                      ) : null}
                    </AnimatePresence>
                  </motion.div>
                  <motion.div
                    transition={morph}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground"
                  >
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        key={draft.removed ? "empty-hint" : "drag-hint"}
                        initial={fadeIn}
                        animate={{ opacity: 1 }}
                        exit={fadeOut}
                        transition={fade}
                      >
                        {draft.removed
                          ? m.project_banner_settings_empty_hint()
                          : m.project_banner_settings_drag_hint()}
                      </motion.span>
                    </AnimatePresence>
                    <AnimatePresence initial={false} mode="popLayout">
                      {preset && !draft.removed && (
                        <motion.a
                          key={preset.src}
                          initial={fadeIn}
                          animate={{ opacity: 1 }}
                          exit={fadeOut}
                          transition={fade}
                          href={preset.url}
                          target="_blank"
                          rel="noreferrer"
                          className="transition-colors hover:text-foreground"
                        >
                          {m.project_banner_template_credit({
                            artist: preset.artist,
                            provider: preset.provider
                          })}
                        </motion.a>
                      )}
                    </AnimatePresence>
                  </motion.div>
                  <motion.div
                    transition={morph}
                    role="group"
                    aria-label={m.project_banner_templates_heading()}
                    className="grid grid-cols-4 gap-2 sm:grid-cols-7"
                  >
                    {bannerPresets.map((entry) => (
                      <Button
                        key={entry.src}
                        variant="image-option"
                        size="image-option"
                        title={entry.label()}
                        aria-label={entry.label()}
                        aria-pressed={
                          !draft.removed && draft.source === entry.src
                        }
                        onClick={() => {
                          setError(false)
                          setDraft((current) => ({
                            source: entry.src,
                            file: undefined,
                            removed: false,
                            settings: {
                              ...current.settings,
                              zoom: 1,
                              x: entry.x,
                              y: entry.y
                            }
                          }))
                        }}
                      >
                        <img
                          src={entry.src}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                          style={{
                            objectPosition: `${entry.x * 100}% ${entry.y * 100}%`
                          }}
                        />
                      </Button>
                    ))}
                    <Button
                      variant="tertiary"
                      size="image-option"
                      title={m.project_banner_settings_upload()}
                      aria-label={m.project_banner_settings_upload()}
                      disabled={!storageAvailable || submitting}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload className="size-3.5" strokeWidth={1.75} />
                    </Button>
                  </motion.div>
                  <motion.div
                    transition={morph}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
                  >
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{m.project_banner_settings_zoom()}</span>
                      <input
                        type="range"
                        aria-label={m.project_banner_settings_zoom()}
                        min={1}
                        max={4}
                        step={0.05}
                        value={draft.settings.zoom}
                        disabled={!image || draft.removed}
                        onChange={(event) =>
                          setZoom(Number(event.target.value))
                        }
                        className="w-36 accent-foreground disabled:opacity-50"
                      />
                    </label>
                    <div className="flex items-center gap-1">
                      <AnimatePresence initial={false} mode="popLayout">
                        {!draft.removed && (
                          <motion.div
                            key="remove"
                            initial={fadeIn}
                            animate={{ opacity: 1 }}
                            exit={fadeOut}
                            transition={morph}
                          >
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDraft((current) => ({
                                  ...current,
                                  removed: true
                                }))
                              }
                            >
                              {m.project_banner_settings_remove()}
                            </Button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <motion.div transition={fade}>
                        <Button variant="ghost" size="sm" onClick={cancel}>
                          {m.common_cancel_button()}
                        </Button>
                      </motion.div>
                      <motion.div transition={fade}>
                        <Button
                          size="sm"
                          disabled={
                            submitting ||
                            (!draft.removed && (error || !imageReady))
                          }
                          onClick={() => void apply()}
                        >
                          {m.project_banner_settings_apply()}
                        </Button>
                      </motion.div>
                    </div>
                  </motion.div>
                  <AnimatePresence initial={false}>
                    {error && (
                      <motion.p
                        key="error"
                        role="alert"
                        initial={fadeIn}
                        animate={{ opacity: 1 }}
                        exit={fadeOut}
                        transition={morph}
                        className="text-xs text-destructive"
                      >
                        {m.project_banner_settings_load_error()}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : applied.removed ? (
                <motion.div
                  key="add"
                  initial={fadeIn}
                  animate={{ opacity: 1 }}
                  exit={fadeOut}
                  transition={morph}
                >
                  <Button
                    variant="tertiary"
                    leadingIcon={ImagePlus}
                    size="banner-add"
                    onClick={() => edit(false)}
                  >
                    {m.project_banner_settings_add()}
                  </Button>
                </motion.div>
              ) : (
                <motion.div
                  key="strip"
                  initial={fadeIn}
                  animate={{ opacity: 1 }}
                  exit={fadeOut}
                  transition={morph}
                  className="group/reveal relative flex flex-col"
                >
                  <Button
                    variant="image-option"
                    size="image-strip"
                    aria-label={m.project_banner_settings_preview()}
                    onClick={() => edit(false)}
                  >
                    <img
                      src={applied.source}
                      alt=""
                      className="size-full object-cover"
                      style={{
                        objectPosition: `${applied.settings.x * 100}% ${applied.settings.y * 100}%`
                      }}
                    />
                  </Button>
                  <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/reveal:pointer-events-auto group-hover/reveal:opacity-100 group-focus-within/reveal:pointer-events-auto group-focus-within/reveal:opacity-100">
                    <Button variant="overlay" onClick={() => edit(false)}>
                      {m.project_banner_settings_change()}
                    </Button>
                    <Button
                      variant="overlay-destructive"
                      size="icon-sm"
                      aria-label={m.project_banner_settings_remove()}
                      onClick={() => edit(true)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
        {AsyncResult.isSuccess(storage) && !storageAvailable && editing && (
          <p className="text-xs text-muted-foreground">
            {m.project_banner_settings_storage_required()}
          </p>
        )}
        {editing &&
          AsyncResult.matchWithError(storage, {
            onInitial: () => null,
            onSuccess: () => null,
            onError: (error) => (
              <ErrorPage error={error} reset={retryStorage} contained />
            ),
            onDefect: (error) => (
              <ErrorPage error={error} reset={retryStorage} contained />
            )
          })}
        {AsyncResult.isFailure(uploadState) && (
          <p role="alert" className="text-xs text-destructive">
            {m.project_banner_settings_save_error()}
          </p>
        )}
        {AsyncResult.isFailure(updateState) && (
          <p role="alert" className="text-xs text-destructive">
            {m.project_banner_settings_save_error()}
          </p>
        )}
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            if (
              !isRasterImageContentType(file.type) ||
              file.size > ATTACHMENT_MAX_BYTES ||
              file.size === 0
            ) {
              setError(true)
              return
            }
            setError(false)
            const url = URL.createObjectURL(file)
            objectUrls.current.push(url)
            setDraft((current) => ({
              source: url,
              file,
              removed: false,
              settings: { ...current.settings, zoom: 1, x: 0.5, y: 0.5 }
            }))
            setEditing(true)
            event.target.value = ""
          }}
        />
      </div>
    </fieldset>
  )
}

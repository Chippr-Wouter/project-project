import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ProjectBanner } from "./ProjectBanner"

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }))
vi.mock("@/atoms/projects", () => ({
  projectBannerPreviewAtom: () => null,
  projectKey: (org: string, slug: string) => `${org}/${slug}`
}))

const photos: HTMLImageElement[] = []
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  photos.length = 0
})

it("keeps project content visible while the banner image is pending or fails", async () => {
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        photos.push(this as unknown as HTMLImageElement)
      }
      src = ""
      crossOrigin = ""
      onload: (() => void) | null = null
      decode = () => Promise.reject(new Error("Image unavailable"))
    }
  )
  const { container } = render(
    <>
      <ProjectBanner
        orgSlug="org"
        slug="project"
        banner={{
          type: "preset",
          preset: "sunset",
          crop: { x: 0.5, y: 0.5, zoom: 1 }
        }}
      />
      <h1>Project content</h1>
    </>
  )
  expect(screen.getByText("Project content")).toBeTruthy()
  expect(container.querySelector("canvas")).toBeNull()
  await act(async () => {
    photos[0].onload?.(new Event("load"))
  })
  expect(screen.getByText("Project content")).toBeTruthy()
  expect(container.querySelector("canvas")).toBeNull()
})

import {
  attachmentUrl,
  type ProjectBanner,
  type ProjectBannerPreset
} from "@projectproject/shared"
import { m } from "@/paraglide/messages"
import type { BannerPrototypeSettings } from "./ProjectBannerPrototypeShader"
import sunsetUrl from "./project-banner-monet-sunset.png"
import water_lily_pondUrl from "./project-banner-monet-87088.jpg"
import wheat_stacksUrl from "./project-banner-monet-64818.jpg"
import cliff_walkUrl from "./project-banner-monet-14620.jpg"
import saint_lazareUrl from "./project-banner-monet-16571.jpg"
import bordigheraUrl from "./project-banner-monet-81537.jpg"

export type BannerPreset = {
  id: ProjectBannerPreset
  src: string
  label: () => string
  artist: string
  provider: string
  url: string
  x: number
  y: number
}

export const bannerPresets: ReadonlyArray<BannerPreset> = [
  {
    id: "sunset",
    src: sunsetUrl,
    label: () => m.project_banner_template_sunset(),
    artist: "Claude Monet",
    provider: m.project_banner_template_user_provided(),
    url: "https://x.com/artistmonet",
    x: 0.5,
    y: 0.65
  },
  {
    id: "water_lily_pond",
    src: water_lily_pondUrl,
    label: () => m.project_banner_template_water_lily_pond(),
    artist: "Claude Monet",
    provider: "Art Institute of Chicago",
    url: "https://www.artic.edu/artworks/87088",
    x: 0.5,
    y: 0.4
  },
  {
    id: "wheat_stacks",
    src: wheat_stacksUrl,
    label: () => m.project_banner_template_wheat_stacks(),
    artist: "Claude Monet",
    provider: "Art Institute of Chicago",
    url: "https://www.artic.edu/artworks/64818",
    x: 0.5,
    y: 0.55
  },
  {
    id: "cliff_walk",
    src: cliff_walkUrl,
    label: () => m.project_banner_template_cliff_walk(),
    artist: "Claude Monet",
    provider: "Art Institute of Chicago",
    url: "https://www.artic.edu/artworks/14620",
    x: 0.5,
    y: 0.6
  },
  {
    id: "saint_lazare",
    src: saint_lazareUrl,
    label: () => m.project_banner_template_saint_lazare(),
    artist: "Claude Monet",
    provider: "Art Institute of Chicago",
    url: "https://www.artic.edu/artworks/16571",
    x: 0.5,
    y: 0.5
  },
  {
    id: "bordighera",
    src: bordigheraUrl,
    label: () => m.project_banner_template_bordighera(),
    artist: "Claude Monet",
    provider: "Art Institute of Chicago",
    url: "https://www.artic.edu/artworks/81537",
    x: 0.5,
    y: 0.5
  }
]

export const bannerDefaults: BannerPrototypeSettings = {
  pixelSize: 2,
  strength: 0.85,
  color: 0.5,
  fade: 0.8,
  opacity: 1,
  overallOpacity: 0.2,
  height: 160,
  noise: 0.3,
  noiseScale: 5.5,
  zoom: 1,
  x: 0.5,
  y: 0.65
}

export const bannerSource = (
  orgSlug: string,
  banner: ProjectBanner | null
): string | null => {
  if (banner === null) return null
  return banner.type === "preset"
    ? (bannerPresets.find((preset) => preset.id === banner.preset)?.src ?? null)
    : attachmentUrl(orgSlug, banner.attachmentId)
}

# T-136 / T-158: Custom project icons and banners

Banner work is tracked in T-158 on `feat/T-158-project-banners`. Icon work remains in T-136 on `feat/T-136-project-icons`. The branches are independent of each other.

## Agreed scope

Reuse the connected organization's attachment storage for project images. Support upload, replacement, and removal. Keep emoji icons available as the fallback. Project image ownership, reference tracking, and cleanup must account for their use outside ticket descriptions.

## Icons

Accept images with simple backgrounds for deterministic background removal. Check whether a clean cutout is plausible. When successful, preview a sticker with a small outline and shadow. Always offer the original image as an alternative.

When the cutout check fails, explain that the background could not be cleanly removed and preview the image full-bleed within the existing project icon shape. Allow square cropping, drag positioning, and zoom. Apply only after the user accepts the preview.

Browser-side icon processing is approved: perform crop, cutout, and sticker previews locally, then upload the accepted result.

## Banner decision

The banner has its own image, independent of the icon. Accept any source aspect ratio and require a 3:1 crop with positioning and zoom.

Offer curated image templates alongside custom upload, including the mountain lake used during prototyping. Templates use the same processing treatment. Selecting a template preserves processing adjustments and applies that image's starting crop.

The prototype bundles these source images locally, with photographer credit linked in the picker. Sources were checked on 2026-09-09 under the [Unsplash License](https://unsplash.com/license) and [Pexels License](https://www.pexels.com/license/).

| Template | Photographer | Source |
| --- | --- | --- |
| Mountain lake | Mattia Poli | [Unsplash](https://unsplash.com/photos/a-mountain-lake-surrounded-by-snow-covered-mountains-XPVVtqCQWzY) |
| Misty forest | Laura Chouette | [Pexels](https://www.pexels.com/photo/misty-forest-landscape-with-evergreen-trees-29508251/) |
| Ocean waves | ysnapshotjournal | [Pexels](https://www.pexels.com/photo/dynamic-ocean-waves-captured-from-above-35295868/) |
| Dunes | Jacob Moore | [Pexels](https://www.pexels.com/photo/sand-dunes-landscape-15852511/) |
| Sandstone canyon | Ekaterina Belinskaya | [Pexels](https://www.pexels.com/photo/beautiful-orange-rock-formation-4671689/) |
| Rocky coastline | Pok Rie | [Pexels](https://www.pexels.com/photo/aerial-view-of-waves-and-rocky-coastline-31743481/) |

The selected treatment is a dithered gradient mask with horizontal noise. Place the banner behind content at the top of every project page, including tickets, sprints, and settings. It adds no layout height and scrolls away with the content. Keep header text and controls fully opaque.

User-approved rendering defaults from the local prototype:

| Parameter | Value |
| --- | --- |
| Dither size | 2 CSS pixels |
| Dither strength | 0.85 |
| Color retention | 0.5 |
| Fade depth | 0.8 |
| Dither opacity | 1 |
| Overall banner opacity | 0.2 |
| Banner height | 160 CSS pixels |
| Horizontal noise | 0.3 |
| Noise scale | 5.5 |

The sample image crop is zoom 1, horizontal position 0, vertical position 0.24. These are the prototype defaults; each uploaded image needs its own crop. The shallow display shows the center of the 3:1 crop without stretching it.

## Prototype

Run the existing frontend with `bun run dev:frontend`. Append `?bannerPrototype=mask` to a local project page. `bannerPrototype=image` retains the alternative color-dithering comparison. Prototype files are `ProjectBannerPrototype.tsx`, `ProjectBannerPrototypeShader.tsx`, and `project-banner-prototype-sample.jpg` beside the existing project components.

The prototype is development-only and keeps image selection and adjustments in memory. It does not persist project images or implement icon cutouts. The sample photo is [Mattia Poli on Unsplash](https://unsplash.com/photos/a-mountain-lake-surrounded-by-snow-covered-mountains-XPVVtqCQWzY).

## Still to agree

- How the cutout check is evaluated.
- Storage of original images versus processed outputs and crop settings.
- Project image references and the shared API shape.
- Final upload entry points, permissions, and disconnected-storage behavior.

This records the agreed product behavior and banner verdict. It is not yet an approved implementation architecture.

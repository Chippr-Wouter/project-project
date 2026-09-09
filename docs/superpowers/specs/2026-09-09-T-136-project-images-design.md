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

Offer six Claude Monet artworks alongside custom upload. Templates use the same processing treatment. Selecting a template preserves processing adjustments and applies that image’s starting crop.

The five Art Institute of Chicago assets were downloaded from its IIIF service; each artwork API record reports `is_public_domain: true` (checked 2026-09-09). Sunset uses the exact user-supplied reproduction for this local prototype; its reproduction licensing has not been independently verified. The title Sunset follows the user’s identification; the exact museum record and date remain unverified.

| Template | Source |
| --- | --- |
| Sunset | User-supplied image; [account shared by the user](https://x.com/artistmonet) |
| Water Lily Pond | [Art Institute of Chicago](https://www.artic.edu/artworks/87088) |
| Stacks of Wheat (End of Summer) | [Art Institute of Chicago](https://www.artic.edu/artworks/64818) |
| Cliff Walk at Pourville | [Art Institute of Chicago](https://www.artic.edu/artworks/14620) |
| Arrival of the Normandy Train, Gare Saint-Lazare | [Art Institute of Chicago](https://www.artic.edu/artworks/16571) |
| Bordighera | [Art Institute of Chicago](https://www.artic.edu/artworks/81537) |

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

The sample image crop is zoom 1, horizontal position 0.5, vertical position 0.65. These are the prototype defaults; each uploaded image needs its own crop. The shallow display shows the center of the 3:1 crop without stretching it.

## Persistence and storage

Approved 2026-09-09: store the original uploaded raster image and normalized 3:1 crop coordinates. `project.md` carries a nullable banner: a preset ID or attachment ID plus crop. Mirror the banner into `project_index` for dashboard and project-list rendering, alongside name, icon, and color.

Project-level image upload preparation and commit reuse the attachment storage, MIME/size validation, serving, deduplication, and orphan lifecycle. Project images have a nullable ticket ID rather than a synthetic ticket. A generic `project_image_reference` table identifies each use by project and slot (currently `banner`, ready for `icon` and further slots). Replacing a slot preserves attachments used by another slot or ticket. Active project images cannot be deleted through the attachment browser.

Owners/admins can change banners. Presets work without connected storage; custom uploads require active storage. Applying updates the header optimistically, and saving errors remain visible. Banners render at the top of every project page and within dashboard cards/project-list rows. Card renders are captured as bitmaps to release their WebGL contexts.

## Remaining icon work

The icon UI and cutout check remain on T-136. Its accepted output can use the same project upload endpoints and `icon` reference slot. No icon processing or custom icon API is included in T-158.

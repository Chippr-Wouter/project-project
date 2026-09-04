import type { TextMatchTransformer } from "@lexical/markdown"
import { $createTextNode } from "lexical"
import {
  figmaSrc,
  figmaViewParams,
  parseFigmaUrl,
  withFigmaParams,
  type FigmaDensity
} from "@projectproject/shared"
import { $createFigmaNode, $isFigmaNode, FigmaNode } from "./FigmaNode"

export const FIGMA_MARKDOWN_RE =
  /\[((?:\\.|[^\]\\])*)\]\((https?:\/\/(?:www\.)?figma\.com\/(?:design|board|slides|proto|file)\/[^)\s]+)\)/

export const formatFigmaMarkdown = (input: {
  readonly label: string
  readonly url: string
  readonly density: FigmaDensity
}): string => {
  const label = input.label.replace(/([[\]\\])/g, "\\$1")
  return `[${label}](${withFigmaParams(input.url, { density: input.density })})`
}

export const unescapeFigmaLabel = (label: string): string =>
  label.replace(/\\(.)/g, "$1")

export const FIGMA_TRANSFORMER: TextMatchTransformer = {
  dependencies: [FigmaNode],
  export: (node) => {
    if (!$isFigmaNode(node)) return null
    return formatFigmaMarkdown({
      label: node.getLabel(),
      url: node.getUrl(),
      density: node.getDensity()
    })
  },
  importRegExp: FIGMA_MARKDOWN_RE,
  regExp: new RegExp(`${FIGMA_MARKDOWN_RE.source}$`),
  replace: (textNode, match) => {
    const [, rawLabel, url] = match
    const ref = url === undefined ? null : parseFigmaUrl(url)
    if (url === undefined || ref === null) {
      textNode.replace($createTextNode(match[0]))
      return
    }
    textNode.replace(
      $createFigmaNode({
        url: figmaSrc(url),
        label: unescapeFigmaLabel(rawLabel ?? ""),
        ref,
        density: figmaViewParams(url).density
      })
    )
  },
  trigger: ")",
  type: "text-match"
}

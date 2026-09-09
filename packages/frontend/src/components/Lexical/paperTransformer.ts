import type { TextMatchTransformer } from "@lexical/markdown"
import { $createTextNode } from "lexical"
import { $createPaperNode, $isPaperNode, PaperNode } from "./PaperNode"
import { isPaperDesignUrl } from "./paperUrl"

const PAPER_MARKDOWN_RE =
  /\[((?:\\.|[^\]\\])*)\]\((https:\/\/app\.paper\.design\/file\/[^)\s]+)\)/i

const formatPaperMarkdown = (input: {
  readonly label: string
  readonly url: string
}): string => {
  const label = input.label.replace(/([[\]\\])/g, "\\$1")
  return `[${label}](${input.url})`
}

const unescapePaperLabel = (label: string): string =>
  label.replace(/\\(.)/g, "$1")

export const PAPER_TRANSFORMER: TextMatchTransformer = {
  dependencies: [PaperNode],
  export: (node) => {
    if (!$isPaperNode(node)) return null
    return formatPaperMarkdown({
      label: node.getLabel(),
      url: node.getUrl()
    })
  },
  importRegExp: PAPER_MARKDOWN_RE,
  regExp: new RegExp(`${PAPER_MARKDOWN_RE.source}$`, "i"),
  replace: (textNode, match) => {
    const [, rawLabel, url] = match
    if (url === undefined || !isPaperDesignUrl(url)) {
      textNode.replace($createTextNode(match[0]))
      return
    }
    textNode.replace(
      $createPaperNode({
        url,
        label: unescapePaperLabel(rawLabel ?? "")
      })
    )
  },
  trigger: ")",
  type: "text-match"
}

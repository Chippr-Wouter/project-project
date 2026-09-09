import { defineExtension } from "lexical"
import { FigmaNode } from "./FigmaNode"

export const FigmaExtension = defineExtension({
  name: "@projectproject/figma",
  nodes: [FigmaNode]
})

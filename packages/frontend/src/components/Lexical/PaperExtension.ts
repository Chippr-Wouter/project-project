import { defineExtension } from "lexical"
import { PaperNode } from "./PaperNode"

export const PaperExtension = defineExtension({
  name: "@projectproject/paper",
  nodes: [PaperNode]
})

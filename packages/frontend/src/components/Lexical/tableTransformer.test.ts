import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS
} from "@lexical/markdown"
import {
  TableNode,
  TableRowNode,
  TableCellNode,
  $isTableNode
} from "@lexical/table"
import { LinkNode } from "@lexical/link"
import { $getRoot, createEditor } from "lexical"
import { expect, it } from "vite-plus/test"
import { createTableTransformer } from "./tableTransformer"

const transformers = [
  createTableTransformer(TRANSFORMERS),
  ...TRANSFORMERS.filter(
    (t) => t.type === "text-format" || t.type === "text-match"
  )
]

it("imports editable cells and preserves a GFM table through export", () => {
  const editor = createEditor({
    nodes: [TableNode, TableRowNode, TableCellNode, LinkNode],
    onError: (error) => {
      throw error
    }
  })
  editor.update(
    () => {
      $convertFromMarkdownString(
        "| Name | Value |\n| --- | ---: |\n| **One** | Two |",
        transformers
      )
      const table = $getRoot().getFirstChild()
      expect($isTableNode(table)).toBe(true)
      expect($convertToMarkdownString(transformers)).toBe(
        "| Name | Value |\n| --- | ---: |\n| **One** | Two |"
      )
    },
    { discrete: true }
  )
})

it.each([
  [
    "Name | Value\n:--- | :---:\nOne | Two",
    "| Name | Value |\n| :--- | :---: |\n| One | Two |"
  ],
  [
    "| Name | Value |\n| --- | --- |\n| a\\|b | `c\\|d` |",
    "| Name | Value |\n| --- | --- |\n| a\\|b | `c\\|d` |"
  ],
  [
    "| Name | Value |\n| --- | --- |\n| One |\n| | Two |",
    "| Name | Value |\n| --- | --- |\n| One |  |\n|  | Two |"
  ],
  [
    "Before\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\nAfter",
    "Before\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\nAfter"
  ],
  ["| Name | Value |\n| --- | --- |", "| Name | Value |\n| --- | --- |"],
  [
    "| Link | Value |\n| --- | --- |\n| [Docs](https://example.com) | ~~old~~ |",
    "| Link | Value |\n| --- | --- |\n| [Docs](https://example.com) | ~~old~~ |"
  ]
])("round-trips table syntax: %s", (input, expected) => {
  const editor = createEditor({
    nodes: [TableNode, TableRowNode, TableCellNode, LinkNode],
    onError: (error) => {
      throw error
    }
  })
  editor.update(
    () => {
      $convertFromMarkdownString(input, transformers)
      expect($convertToMarkdownString(transformers)).toBe(expected)
      $convertFromMarkdownString(expected, transformers)
      expect($convertToMarkdownString(transformers)).toBe(expected)
    },
    { discrete: true }
  )
})

it("leaves pipe text and malformed table delimiters as paragraphs", () => {
  const editor = createEditor({
    nodes: [TableNode, TableRowNode, TableCellNode, LinkNode],
    onError: (error) => {
      throw error
    }
  })
  editor.update(
    () => {
      $convertFromMarkdownString("a | b\nnot | a delimiter", transformers)
      expect($getRoot().getFirstChild()?.getType()).toBe("paragraph")
      expect($convertToMarkdownString(transformers)).toBe(
        "a | b\nnot | a delimiter"
      )
    },
    { discrete: true }
  )
})

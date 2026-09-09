import {
  $convertFromMarkdownString,
  type MultilineElementTransformer,
  type Transformer
} from "@lexical/markdown"
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  TableCellNode,
  TableNode,
  TableRowNode
} from "@lexical/table"
import { $isElementNode, type ElementFormatType } from "lexical"

function splitRow(line: string) {
  const cells: string[] = []
  let cell = ""
  let escaped = false
  let endsWithDelimiter = false
  for (const character of line.trim()) {
    endsWithDelimiter = character === "|" && !escaped
    if (endsWithDelimiter) {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += character
    }
    escaped = character === "\\" && !escaped
  }
  cells.push(cell.trim())
  if (line.trimStart().startsWith("|")) cells.shift()
  if (endsWithDelimiter) cells.pop()
  return cells
}

export function createTableTransformer(
  transformers: readonly Transformer[]
): MultilineElementTransformer {
  const inlineTransformers = transformers.filter(
    (transformer) =>
      transformer.type === "text-format" || transformer.type === "text-match"
  )

  return {
    type: "multiline-element",
    dependencies: [TableNode, TableRowNode, TableCellNode],
    regExpStart: /^ {0,3}\S.*\|.*$/,
    replace: () => false,
    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
      const header = splitRow(lines[startLineIndex])
      const delimiter = splitRow(lines[startLineIndex + 1] ?? "")
      if (
        header.length !== delimiter.length ||
        !delimiter.every((cell) => /^:?-+:?$/.test(cell))
      )
        return null

      const alignments: ElementFormatType[] = delimiter.map((cell) =>
        cell.startsWith(":")
          ? cell.endsWith(":")
            ? "center"
            : "left"
          : cell.endsWith(":")
            ? "right"
            : ""
      )
      const rows = [header]
      let end = startLineIndex + 1
      while (end + 1 < lines.length) {
        const line = lines[end + 1]
        if (
          !line.trim() ||
          /^ {0,3}(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s|`{3}|~{3})/.test(line)
        )
          break
        rows.push(splitRow(line))
        end++
      }
      const table = $createTableNode()
      for (const [rowIndex, values] of rows.entries()) {
        const row = $createTableRowNode()
        for (const [columnIndex, alignment] of alignments.entries()) {
          const cell = $createTableCellNode(
            rowIndex === 0
              ? TableCellHeaderStates.ROW
              : TableCellHeaderStates.NO_STATUS
          )
          cell.setFormat(alignment)
          $convertFromMarkdownString(
            (values[columnIndex] ?? "").replace(/\\\|/g, "|"),
            inlineTransformers,
            cell
          )
          row.append(cell)
        }
        table.append(row)
      }
      rootNode.append(table)
      return [true, end]
    },
    export: (node, traverseChildren) => {
      if (!$isTableNode(node)) return null
      const rows = node.getChildren().filter($isTableRowNode)
      const header = rows[0]?.getChildren().filter($isTableCellNode) ?? []
      if (header.length === 0) return ""
      const output = rows.map((row) => {
        const cells = row
          .getChildren()
          .filter($isTableCellNode)
          .map((cell) =>
            cell
              .getChildren()
              .map((child) =>
                $isElementNode(child)
                  ? traverseChildren(child)
                  : child.getTextContent()
              )
              .join("&#10;")
              .replace(/\|/g, "\\|")
              .replace(/\n/g, "&#10;")
          )
        return `| ${cells.join(" | ")} |`
      })
      const delimiter = header.map((cell) => {
        switch (cell.getFormatType()) {
          case "left":
            return ":---"
          case "center":
            return ":---:"
          case "right":
            return "---:"
          default:
            return "---"
        }
      })
      output.splice(1, 0, `| ${delimiter.join(" | ")} |`)
      return output.join("\n")
    }
  }
}

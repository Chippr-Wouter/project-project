import { describe, expect, it } from "vite-plus/test"
import { branchOpensInNewTab, branchUrl } from "./branchUrl"

const repo = "acme/widgets"
const branch = "feat/T-46-editor"

describe("branchUrl", () => {
  it("links GitHub to the branch tree page", () => {
    expect(branchUrl("github", repo, branch)).toBe(
      "https://github.com/acme/widgets/tree/feat/T-46-editor"
    )
  })

  it("links github.dev to the branch on the web editor", () => {
    expect(branchUrl("github_dev", repo, branch)).toBe(
      "https://github.dev/acme/widgets/tree/feat/T-46-editor"
    )
  })

  it("uses the VS Code clone deep link with an encoded https clone url", () => {
    expect(branchUrl("vscode", repo, branch)).toBe(
      "vscode://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Facme%2Fwidgets.git"
    )
  })

  it("uses the Cursor clone deep link with an encoded https clone url", () => {
    expect(branchUrl("cursor", repo, branch)).toBe(
      "cursor://vscode.git/clone?url=https%3A%2F%2Fgithub.com%2Facme%2Fwidgets.git"
    )
  })
})

describe("branchOpensInNewTab", () => {
  it("opens web targets in a new tab", () => {
    expect(branchOpensInNewTab("github")).toBe(true)
    expect(branchOpensInNewTab("github_dev")).toBe(true)
  })

  it("hands desktop editor schemes to the OS without a new tab", () => {
    expect(branchOpensInNewTab("vscode")).toBe(false)
    expect(branchOpensInNewTab("cursor")).toBe(false)
  })
})

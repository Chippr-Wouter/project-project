import { expect, it } from "vite-plus/test"
import { githubRepoMatchesQuery, parseGithubRepoSlug } from "./GitHub"

const repo = {
  owner: { login: "outside-org" },
  name: "project-project",
  description: "Markdown-first planning"
}

it("matches repositories by organization owner", () => {
  expect(githubRepoMatchesQuery(repo, "outside-org")).toBe(true)
})

it("matches repository search across owner and name tokens", () => {
  expect(githubRepoMatchesQuery(repo, "outside project")).toBe(true)
})

it("does not match unrelated repositories", () => {
  expect(githubRepoMatchesQuery(repo, "personal-only")).toBe(false)
})

it("parses exact owner and repository slugs", () => {
  expect(parseGithubRepoSlug("outside-org/project-project")).toEqual({
    owner: "outside-org",
    name: "project-project"
  })
})

it("rejects partial repository slugs", () => {
  expect(parseGithubRepoSlug("outside-org / project-project")).toBeNull()
})

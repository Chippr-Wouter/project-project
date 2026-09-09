export const isPaperDesignUrl = (value: string): boolean => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== "https:") return false
  if (url.hostname.toLowerCase() !== "app.paper.design") return false
  if (url.username !== "" || url.password !== "" || url.port !== "") {
    return false
  }

  const [kind, fileId] = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)

  return kind === "file" && fileId !== undefined
}

export interface McpToolErrorResult {
  readonly content: ReadonlyArray<{
    readonly type: "text"
    readonly text: string
  }>
  readonly isError: true
}

const text = (s: string): McpToolErrorResult => ({
  content: [{ type: "text", text: s }],
  isError: true
})

const reasonOf = (e: unknown): string | undefined => {
  if (typeof e !== "object" || e === null || !("reason" in e)) return undefined
  const reason = (e as { reason?: unknown }).reason
  return typeof reason === "string" ? reason : undefined
}

export const mapToolError = (e: unknown): McpToolErrorResult => {
  if (typeof e !== "object" || e === null || !("_tag" in e)) {
    return text("Internal error.")
  }
  const tag = String((e as { _tag: unknown })._tag)
  switch (tag) {
    case "Unauthorized":
      return text("Unauthorized.")
    case "Forbidden":
      return text("Forbidden.")
    case "NotFound":
      return text("Not found.")
    case "Conflict": {
      const reason = reasonOf(e)
      return text(reason ? `Conflict (${reason}).` : "Conflict.")
    }
    case "Validation": {
      const reason = reasonOf(e)
      return text(
        reason ? `Validation error (${reason}).` : "Validation error."
      )
    }
    case "MentionInvalid": {
      const kind =
        typeof e === "object" && e !== null && "kind" in e
          ? String((e as { kind?: unknown }).kind)
          : undefined
      const href =
        typeof e === "object" && e !== null && "href" in e
          ? String((e as { href?: unknown }).href)
          : undefined
      const detail = kind && href ? `${kind}: ${href}` : (kind ?? href ?? "")
      return text(
        detail
          ? `Mention error (${detail}). Use [label](mention:user/<id>) or [label](mention:ticket/<T-N>); discover ids via list_members and list_tickets.`
          : "Mention error."
      )
    }
    case "StorageNotConnected":
      return text(
        "StorageNotConnected: Attachments are unavailable because this organization has not connected storage. Connect storage in organization settings, then retry."
      )
    case "StorageConfigMissing":
      return text(
        "StorageConfigMissing: Server storage configuration is missing. Ask the server administrator to configure attachment storage, then retry."
      )
    case "StorageError":
      return text(
        "StorageError: Attachment storage could not complete the operation. Check the connection in organization settings and retry."
      )
    case "AttachmentNotUploaded":
      return text(
        "AttachmentNotUploaded: The file has not been uploaded. Complete the PUT to uploadUrl, then retry commit_ticket_attachment. If the upload URL expired, prepare a new upload."
      )
    case "AttachmentTooLarge":
      return text(
        "AttachmentTooLarge: The file must be non-empty, at most 25 MiB, and match the byteSize supplied during preparation."
      )
    case "AttachmentTypeRejected":
      return text(
        "AttachmentTypeRejected: Use PNG, JPEG, GIF, WebP, AVIF, PDF, ZIP, gzip, or tar."
      )
    case "SchemaError":
      return text(
        e instanceof Error
          ? `Validation error: ${e.message}`
          : "Validation error."
      )
    case "MarkdownError":
      return text("Document read failed.")
    case "BetterAuthError":
      return text("Auth provider error.")
    case "TicketIdTaken":
    case "GroupIdTaken":
      return text("Identifier already taken.")
    case "SprintCompletedImmutable":
      return text("Sprint is already completed and cannot be modified.")
    case "BranchNotFound": {
      const name =
        typeof e === "object" && e !== null && "name" in e
          ? String((e as { name?: unknown }).name)
          : undefined
      return text(
        name
          ? `Branch not found on remote: ${name}.`
          : "Branch not found on remote."
      )
    }
    case "BranchExists": {
      const name =
        typeof e === "object" && e !== null && "branch" in e
          ? String((e as { branch?: unknown }).branch)
          : undefined
      return text(
        name ? `Branch already exists: ${name}.` : "Branch already exists."
      )
    }
    case "BranchProtected":
      return text("Branch is protected.")
    case "GitHubTokenExpired":
      return text("GitHub token expired — reconnect GitHub.")
    case "GitHubScopeInsufficient":
      return text("GitHub token is missing required scopes.")
    case "RepoGone":
      return text("Connected GitHub repository is gone.")
    case "RateLimited":
      return text("Rate limited by GitHub — retry later.")
    case "GitHubError": {
      const message =
        typeof e === "object" && e !== null && "message" in e
          ? String((e as { message?: unknown }).message)
          : undefined
      return text(message ? `GitHub error: ${message}.` : "GitHub error.")
    }
    default:
      return text("Internal error.")
  }
}

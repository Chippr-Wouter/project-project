import { it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { S3Storage } from "../Services/S3Storage"
import { S3StorageLive } from "./S3Storage"
import { describe, expect } from "vite-plus/test"
import {
  attachmentObjectKey,
  normalizeEtag,
  sanitizeFilename
} from "../Services/S3Storage"

const base = {
  keyPrefix: null,
  orgSlug: "acme",
  projectSlug: "web",
  ticketId: "T-12",
  attachmentId: "01JBX7Q2K9ZWCVE8MTQ4RXPGHN",
  filename: "screenshot.png"
}

describe("attachmentObjectKey", () => {
  it("namespaces by org, project and ticket", () => {
    expect(attachmentObjectKey(base)).toBe(
      "orgs/acme/projects/web/tickets/T-12/01JBX7Q2K9ZWCVE8MTQ4RXPGHN-screenshot.png"
    )
  })

  it("applies a key prefix when the bucket is shared", () => {
    expect(attachmentObjectKey({ ...base, keyPrefix: "projectproject" })).toBe(
      "projectproject/orgs/acme/projects/web/tickets/T-12/01JBX7Q2K9ZWCVE8MTQ4RXPGHN-screenshot.png"
    )
  })

  it("trims leading and trailing slashes from the prefix", () => {
    expect(attachmentObjectKey({ ...base, keyPrefix: "/pp/" })).toBe(
      "pp/orgs/acme/projects/web/tickets/T-12/01JBX7Q2K9ZWCVE8MTQ4RXPGHN-screenshot.png"
    )
  })

  it("keeps the attachment id as the uniqueness guarantee", () => {
    const a = attachmentObjectKey(base)
    const b = attachmentObjectKey({
      ...base,
      attachmentId: "01JBX000000000000000000000"
    })
    expect(a).not.toBe(b)
  })
})

describe("sanitizeFilename", () => {
  it("strips path separators", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("etc-passwd")
  })

  it("strips characters that break object keys", () => {
    expect(sanitizeFilename("my file (1)?.png")).toBe("my-file-1.png")
  })

  it("collapses runs of separators", () => {
    expect(sanitizeFilename("a///b   c.png")).toBe("a-b-c.png")
  })

  it("preserves a normal filename", () => {
    expect(sanitizeFilename("screenshot.png")).toBe("screenshot.png")
  })

  it("falls back when the name sanitizes to nothing", () => {
    expect(sanitizeFilename("///")).toBe("file")
  })

  it("truncates an absurdly long name", () => {
    expect(
      sanitizeFilename(`${"a".repeat(300)}.png`).length
    ).toBeLessThanOrEqual(120)
  })
})

describe("normalizeEtag", () => {
  it("strips the quotes S3 wraps an etag in", () => {
    expect(normalizeEtag('"d41d8cd98f00b204e9800998ecf8427e"')).toBe(
      "d41d8cd98f00b204e9800998ecf8427e"
    )
  })

  it("lowercases so two spellings of one object dedupe together", () => {
    expect(normalizeEtag('"D41D8CD98F00B204E9800998ECF8427E"')).toBe(
      "d41d8cd98f00b204e9800998ecf8427e"
    )
  })

  it("refuses a multipart etag, which is not a content hash", () => {
    expect(normalizeEtag('"d41d8cd98f00b204e9800998ecf8427e-3"')).toBeNull()
  })

  it("refuses a missing etag", () => {
    expect(normalizeEtag(undefined)).toBeNull()
  })

  it("refuses anything that is not a hex digest", () => {
    expect(normalizeEtag('"not-a-digest"')).toBeNull()
  })
})

describe("S3 endpoint transport", () => {
  const connection = {
    bucket: "test",
    region: "auto",
    keyPrefix: null,
    forcePathStyle: true,
    accessKeyId: "test",
    secretAccessKey: "test"
  }
  it.effect.each([
    "http://storage.example.test",
    "http://localhost.example.test",
    "ftp://localhost",
    "file:///tmp/bucket",
    "not a URL"
  ])("rejects %s before signing", (endpoint) =>
    Effect.gen(function* () {
      const storage = yield* S3Storage
      const error = yield* Effect.flip(
        storage.presignPut({ ...connection, endpoint }, "file", "image/png", 60)
      )
      expect(error._tag).toBe("S3Unavailable")
      expect(error.retryable).toBe(false)
    }).pipe(Effect.provide(S3StorageLive))
  )
  it.effect.each([
    "https://storage.example.test",
    "http://localhost:9000",
    "http://127.0.0.1:9000",
    "http://[::1]:9000"
  ])("allows %s", (endpoint) =>
    Effect.gen(function* () {
      const storage = yield* S3Storage
      const url = yield* storage.presignPut(
        { ...connection, endpoint },
        "file",
        "image/png",
        60
      )
      expect(new URL(url).origin).toBe(endpoint)
    }).pipe(Effect.provide(S3StorageLive))
  )
})

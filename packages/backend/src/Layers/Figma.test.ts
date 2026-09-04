import { it } from "@effect/vitest"
import {
  FigmaAuthInvalid,
  FigmaError,
  FigmaFileNotFound,
  FigmaRateLimited
} from "@projectproject/shared"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, vi } from "vitest"
import { figmaAuthHeader, figmaImageScale, Figma } from "../Services/Figma"
import { FigmaLive } from "./Figma"

describe("figmaAuthHeader", () => {
  it("uses a bearer header for an oauth credential", () => {
    expect(figmaAuthHeader({ _tag: "Bearer", token: "abc" })).toEqual({
      Authorization: "Bearer abc"
    })
  })

  it("uses the figma token header for a personal access token", () => {
    expect(figmaAuthHeader({ _tag: "FigmaToken", token: "abc" })).toEqual({
      "X-Figma-Token": "abc"
    })
  })
})

describe("figmaImageScale", () => {
  it("clamps below the minimum", () => {
    expect(figmaImageScale(0)).toBe(0.01)
  })

  it("clamps above the maximum", () => {
    expect(figmaImageScale(99)).toBe(4)
  })

  it("passes a valid scale through", () => {
    expect(figmaImageScale(2)).toBe(2)
  })
})

const credential = { _tag: "FigmaToken" as const, token: "secret-token" }

const jsonResponse = (
  status: number,
  body: unknown,
  headers?: Record<string, string>
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  })

describe("FigmaLive status mapping", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("maps 401 to FigmaAuthInvalid", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(401, { message: "bad token" }))
      )
      const figma = yield* Figma
      const error = yield* Effect.flip(figma.getFile(credential, "abc123"))
      expect(Schema.is(FigmaAuthInvalid)(error)).toBe(true)
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("maps 403 to FigmaAuthInvalid", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(403, { message: "forbidden" }))
      )
      const figma = yield* Figma
      const error = yield* Effect.flip(figma.getFile(credential, "abc123"))
      expect(Schema.is(FigmaAuthInvalid)(error)).toBe(true)
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("maps 404 to FigmaFileNotFound carrying the fileKey", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(404, { message: "not found" }))
      )
      const figma = yield* Figma
      const error = yield* Effect.flip(figma.getFile(credential, "missing-key"))
      if (!Schema.is(FigmaFileNotFound)(error)) throw error
      expect(error.fileKey).toBe("missing-key")
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect(
    "maps 429 to FigmaRateLimited reading the Retry-After header",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () =>
            jsonResponse(
              429,
              { message: "slow down" },
              { "Retry-After": "42" }
            )
          )
        )
        const figma = yield* Figma
        const error = yield* Effect.flip(figma.getFile(credential, "abc123"))
        if (!Schema.is(FigmaRateLimited)(error)) throw error
        expect(error.retryAfterSeconds).toBe(42)
      }).pipe(Effect.provide(FigmaLive))
  )

  it.effect(
    "defaults FigmaRateLimited to 60 seconds when Retry-After is absent",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => jsonResponse(429, { message: "slow down" }))
        )
        const figma = yield* Figma
        const error = yield* Effect.flip(figma.getFile(credential, "abc123"))
        if (!Schema.is(FigmaRateLimited)(error)) throw error
        expect(error.retryAfterSeconds).toBe(60)
      }).pipe(Effect.provide(FigmaLive))
  )

  it.effect(
    "defaults FigmaRateLimited to 60 seconds when Retry-After is unparseable",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () =>
            jsonResponse(
              429,
              { message: "slow down" },
              { "Retry-After": "not-a-number" }
            )
          )
        )
        const figma = yield* Figma
        const error = yield* Effect.flip(figma.getFile(credential, "abc123"))
        if (!Schema.is(FigmaRateLimited)(error)) throw error
        expect(error.retryAfterSeconds).toBe(60)
      }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("maps 500 to FigmaError", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(500, { message: "kaboom" }))
      )
      const figma = yield* Figma
      const error = yield* Effect.flip(figma.getFile(credential, "abc123"))
      if (!Schema.is(FigmaError)(error)) throw error
      expect(error.reason).toBe("kaboom")
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("maps a successful getFile response", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(200, {
            name: "My Design File",
            lastModified: "2026-01-02T03:04:05Z",
            thumbnailUrl: "https://figma-thumbnails.example/abc.png"
          })
        )
      )
      const figma = yield* Figma
      const file = yield* figma.getFile(credential, "abc123")
      expect(file.name).toBe("My Design File")
      expect(file.lastModified?.toISOString()).toBe("2026-01-02T03:04:05.000Z")
      expect(file.thumbnailUrl).toBe("https://figma-thumbnails.example/abc.png")
    }).pipe(Effect.provide(FigmaLive))
  )
})

describe("FigmaLive subtle behaviours", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect(
    "treats a duplicate dev resource URL as success returning null",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () =>
            jsonResponse(200, {
              errors: [
                {
                  file_key: "abc123",
                  node_id: "1:2",
                  error: "A dev resource with this URL already exists on this node"
                }
              ]
            })
          )
        )
        const figma = yield* Figma
        const result = yield* figma.createDevResource(credential, {
          fileKey: "abc123",
          nodeId: "1:2",
          name: "Spec",
          url: "https://example.com/spec"
        })
        expect(result).toBeNull()
      }).pipe(Effect.provide(FigmaLive))
  )

  it.effect(
    "treats the 10 dev resource cap as success returning null",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () =>
            jsonResponse(200, {
              errors: [
                {
                  file_key: "abc123",
                  node_id: "1:2",
                  error: "Node already has 10 dev resources, the maximum allowed"
                }
              ]
            })
          )
        )
        const figma = yield* Figma
        const result = yield* figma.createDevResource(credential, {
          fileKey: "abc123",
          nodeId: "1:2",
          name: "Spec",
          url: "https://example.com/spec"
        })
        expect(result).toBeNull()
      }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("returns the created dev resource id on success", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(200, {
            links_created: [{ id: "dev-resource-1" }],
            errors: []
          })
        )
      )
      const figma = yield* Figma
      const result = yield* figma.createDevResource(credential, {
        fileKey: "abc123",
        nodeId: "1:2",
        name: "Spec",
        url: "https://example.com/spec"
      })
      expect(result).toBe("dev-resource-1")
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("treats deleting an already-gone dev resource as success", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(404, { message: "not found" }))
      )
      const figma = yield* Figma
      yield* figma.deleteDevResource(credential, "abc123", "dev-resource-1")
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect("getNodeName fails with FigmaFileNotFound when the node is absent", () =>
    Effect.gen(function* () {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse(200, { nodes: {} }))
      )
      const figma = yield* Figma
      const error = yield* Effect.flip(
        figma.getNodeName(credential, "abc123", "1:2")
      )
      if (!Schema.is(FigmaFileNotFound)(error)) throw error
      expect(error.fileKey).toBe("abc123")
    }).pipe(Effect.provide(FigmaLive))
  )

  it.effect(
    "renderNode falls back to the file thumbnail when nodeId is null",
    () =>
      Effect.gen(function* () {
        const fetchMock = vi.fn(async (input: string | URL) => {
          const url = String(input)
          if (url.includes("/v1/files/")) {
            return jsonResponse(200, {
              name: "File",
              lastModified: null,
              thumbnailUrl: "https://figma-thumbnails.example/thumb.png"
            })
          }
          return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
        })
        vi.stubGlobal("fetch", fetchMock)
        const figma = yield* Figma
        const bytes = yield* figma.renderNode(credential, "abc123", null, 1)
        expect(Array.from(bytes)).toEqual([1, 2, 3])
      }).pipe(Effect.provide(FigmaLive))
  )

  it.effect(
    "renderNode fails with node_not_renderable when the images map has a null entry",
    () =>
      Effect.gen(function* () {
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => jsonResponse(200, { images: { "1:2": null } }))
        )
        const figma = yield* Figma
        const error = yield* Effect.flip(
          figma.renderNode(credential, "abc123", "1:2", 1)
        )
        if (!Schema.is(FigmaError)(error)) throw error
        expect(error.reason).toBe("node_not_renderable")
      }).pipe(Effect.provide(FigmaLive))
  )
})

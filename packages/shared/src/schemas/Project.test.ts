import * as Schema from "effect/Schema"
import { describe, expect, it } from "vite-plus/test"
import {
  CreatableProjectKey,
  Project,
  ProjectKey,
  UpdateProjectInput
} from "./Project"

const isoDate = "2026-05-18T00:00:00.000Z"

const decodeCreatable = Schema.decodeUnknownEither(CreatableProjectKey)
const decodeProjectKey = Schema.decodeUnknownEither(ProjectKey)

describe("ProjectKey", () => {
  it("accepts the legacy T key", () => {
    expect(decodeProjectKey("T")._tag).toBe("Right")
  })

  it("accepts uppercase alphanumeric keys that start with a letter", () => {
    expect(decodeCreatable("FOO")._tag).toBe("Right")
    expect(decodeCreatable("A1B2")._tag).toBe("Right")
    expect(decodeCreatable("ABCDEFGHIJ")._tag).toBe("Right")
  })

  it("rejects invalid keys for new projects", () => {
    for (const value of ["T", "foo", "1FOO", "A-1", "ABCDEFGHIJK"]) {
      expect(decodeCreatable(value)._tag).toBe("Left")
    }
  })
})

describe("Project with identity", () => {
  const decode = Schema.decodeUnknownEither(Project)
  const base = {
    org: "demo",
    slug: "demo",
    key: "T",
    name: "Demo",
    createdBy: "user-1",
    createdAt: isoDate,
    icon: "🚀",
    color: "#abcdef"
  }

  it("accepts a project with icon and color", () => {
    expect(decode(base)._tag).toBe("Right")
  })

  it("rejects a project missing icon", () => {
    const { icon: _icon, ...withoutIcon } = base
    expect(decode(withoutIcon)._tag).toBe("Left")
  })

  it("rejects a project missing color", () => {
    const { color: _color, ...withoutColor } = base
    expect(decode(withoutColor)._tag).toBe("Left")
  })

  it("validates color as 6-digit hex", () => {
    expect(decode({ ...base, color: "not-hex" })._tag).toBe("Left")
    expect(decode({ ...base, color: "#ABC" })._tag).toBe("Left")
    expect(decode({ ...base, color: "#ABCDEF" })._tag).toBe("Right")
  })
})

describe("UpdateProjectInput with identity", () => {
  const decode = Schema.decodeUnknownEither(UpdateProjectInput)

  it("accepts an empty update", () => {
    expect(decode({})._tag).toBe("Right")
  })

  it("accepts an icon-only update", () => {
    expect(decode({ icon: "📦" })._tag).toBe("Right")
  })

  it("accepts a color-only update", () => {
    expect(decode({ color: "#abcdef" })._tag).toBe("Right")
  })

  it("rejects an invalid color", () => {
    expect(decode({ color: "blue" })._tag).toBe("Left")
  })
})

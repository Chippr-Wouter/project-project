import * as Schema from "effect/Schema"
import { describe, expect, it } from "vite-plus/test"
import {
  CreatableProjectKey,
  Project,
  ProjectKey,
  UpdateProjectInput
} from "./Project"

const isoDate = "2026-05-18T00:00:00.000Z"

const decodeCreatable = Schema.decodeUnknownExit(CreatableProjectKey)
const decodeProjectKey = Schema.decodeUnknownExit(ProjectKey)

describe("ProjectKey", () => {
  it("accepts the legacy T key", () => {
    expect(decodeProjectKey("T")._tag).toBe("Success")
  })

  it("accepts uppercase alphanumeric keys that start with a letter", () => {
    expect(decodeCreatable("FOO")._tag).toBe("Success")
    expect(decodeCreatable("A1B2")._tag).toBe("Success")
    expect(decodeCreatable("ABCDEFGHIJ")._tag).toBe("Success")
  })

  it("rejects invalid keys for new projects", () => {
    for (const value of ["T", "foo", "1FOO", "A-1", "ABCDEFGHIJK"]) {
      expect(decodeCreatable(value)._tag).toBe("Failure")
    }
  })
})

describe("Project with identity", () => {
  const decode = Schema.decodeUnknownExit(Project)
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
    expect(decode(base)._tag).toBe("Success")
  })

  it("rejects a project missing icon", () => {
    const { icon: _icon, ...withoutIcon } = base
    expect(decode(withoutIcon)._tag).toBe("Failure")
  })

  it("rejects a project missing color", () => {
    const { color: _color, ...withoutColor } = base
    expect(decode(withoutColor)._tag).toBe("Failure")
  })

  it("validates color as 6-digit hex", () => {
    expect(decode({ ...base, color: "not-hex" })._tag).toBe("Failure")
    expect(decode({ ...base, color: "#ABC" })._tag).toBe("Failure")
    expect(decode({ ...base, color: "#ABCDEF" })._tag).toBe("Success")
  })
})

describe("UpdateProjectInput with identity", () => {
  const decode = Schema.decodeUnknownExit(UpdateProjectInput)

  it("accepts an empty update", () => {
    expect(decode({})._tag).toBe("Success")
  })

  it("accepts an icon-only update", () => {
    expect(decode({ icon: "📦" })._tag).toBe("Success")
  })

  it("accepts a color-only update", () => {
    expect(decode({ color: "#abcdef" })._tag).toBe("Success")
  })

  it("rejects an invalid color", () => {
    expect(decode({ color: "blue" })._tag).toBe("Failure")
  })
})

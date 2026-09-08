import { cleanup, render } from "@testing-library/react"
import * as Schema from "effect/Schema"
import { afterEach, describe, expect, it } from "vitest"
import { TicketId, type FigmaRef } from "@projectproject/shared"
import {
  FigmaTicketProvider,
  useFigmaMetadata,
  type FigmaTicketTarget
} from "./figmaMetadata"

const makeTicketId = Schema.decodeUnknownSync(TicketId)

const REF: FigmaRef = {
  kind: "design",
  fileKey: "abc123",
  nodeId: null,
  slug: "checkout"
}

function Probe({ reference }: { reference: FigmaRef }) {
  const metadata = useFigmaMetadata(reference)
  return <span>{metadata?.name ?? "unresolved"}</span>
}

afterEach(() => {
  cleanup()
})

describe("useFigmaMetadata", () => {
  it("does not throw when the ticket target resolves from null to non-null", () => {
    const { rerender } = render(
      <FigmaTicketProvider target={null}>
        <Probe reference={REF} />
      </FigmaTicketProvider>
    )

    const target: FigmaTicketTarget = {
      orgSlug: "acme",
      slug: "proj",
      ticketId: makeTicketId("AB-1")
    }

    expect(() =>
      rerender(
        <FigmaTicketProvider target={target}>
          <Probe reference={REF} />
        </FigmaTicketProvider>
      )
    ).not.toThrow()
  })

  it("does not throw when a ref resolves from null to non-null", () => {
    const target: FigmaTicketTarget = {
      orgSlug: "acme",
      slug: "proj",
      ticketId: makeTicketId("AB-1")
    }

    function OptionalProbe({ reference }: { reference: FigmaRef | null }) {
      const metadata = useFigmaMetadata(reference)
      return <span>{metadata?.name ?? "unresolved"}</span>
    }

    const { rerender } = render(
      <FigmaTicketProvider target={target}>
        <OptionalProbe reference={null} />
      </FigmaTicketProvider>
    )

    expect(() =>
      rerender(
        <FigmaTicketProvider target={target}>
          <OptionalProbe reference={REF} />
        </FigmaTicketProvider>
      )
    ).not.toThrow()
  })
})

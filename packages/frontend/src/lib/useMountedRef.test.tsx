import { describe, expect, it } from "vite-plus/test"
import { StrictMode, type RefObject } from "react"
import { render } from "@testing-library/react"
import { useMountedRef } from "./useMountedRef"

function Probe({ onRef }: { onRef: (ref: RefObject<boolean>) => void }) {
  const mounted = useMountedRef()
  onRef(mounted)
  return null
}

describe("useMountedRef", () => {
  it("reports mounted after StrictMode's double mount, which a write-only unmount flag would not", () => {
    let captured: RefObject<boolean> | null = null
    render(
      <StrictMode>
        <Probe
          onRef={(ref) => {
            captured = ref
          }}
        />
      </StrictMode>
    )
    expect(captured!.current).toBe(true)
  })

  it("reports mounted in a plain render", () => {
    let captured: RefObject<boolean> | null = null
    render(
      <Probe
        onRef={(ref) => {
          captured = ref
        }}
      />
    )
    expect(captured!.current).toBe(true)
  })

  it("reports unmounted after the tree is torn down", () => {
    let captured: RefObject<boolean> | null = null
    const view = render(
      <Probe
        onRef={(ref) => {
          captured = ref
        }}
      />
    )
    view.unmount()
    expect(captured!.current).toBe(false)
  })
})

import type { FigmaRef } from "@projectproject/shared"

export interface FigmaLinkMetadata {
  readonly name: string
  readonly fileName: string
}

export const useFigmaMetadata = (
  _ref: FigmaRef | null
): FigmaLinkMetadata | null => null

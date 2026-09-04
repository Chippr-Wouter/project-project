import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  FigmaAuthInvalid,
  FigmaError,
  FigmaFileNotFound,
  FigmaRateLimited
} from "@projectproject/shared"

export type FigmaCredential =
  | { readonly _tag: "Bearer"; readonly token: string }
  | { readonly _tag: "FigmaToken"; readonly token: string }

export type FigmaCallError =
  | FigmaAuthInvalid
  | FigmaRateLimited
  | FigmaFileNotFound
  | FigmaError

export const figmaAuthHeader = (
  credential: FigmaCredential
): Record<string, string> =>
  credential._tag === "Bearer"
    ? { Authorization: `Bearer ${credential.token}` }
    : { "X-Figma-Token": credential.token }

export const figmaImageScale = (scale: number): number =>
  Math.min(4, Math.max(0.01, Number.isFinite(scale) ? scale : 1))

export interface FigmaFileSummary {
  readonly name: string
  readonly lastModified: Date | null
  readonly thumbnailUrl: string | null
}

export interface FigmaNodeSummary {
  readonly name: string
}

export interface FigmaIdentity {
  readonly id: string
  readonly handle: string | null
  readonly email: string | null
}

export interface FigmaShape {
  readonly getMe: (
    credential: FigmaCredential
  ) => Effect.Effect<FigmaIdentity, FigmaCallError>
  readonly getFile: (
    credential: FigmaCredential,
    fileKey: string
  ) => Effect.Effect<FigmaFileSummary, FigmaCallError>
  readonly getNodeName: (
    credential: FigmaCredential,
    fileKey: string,
    nodeId: string
  ) => Effect.Effect<FigmaNodeSummary, FigmaCallError>
  readonly renderNode: (
    credential: FigmaCredential,
    fileKey: string,
    nodeId: string | null,
    scale: number
  ) => Effect.Effect<Uint8Array, FigmaCallError>
  readonly createDevResource: (
    credential: FigmaCredential,
    input: {
      readonly fileKey: string
      readonly nodeId: string
      readonly name: string
      readonly url: string
    }
  ) => Effect.Effect<string | null, FigmaCallError>
  readonly deleteDevResource: (
    credential: FigmaCredential,
    fileKey: string,
    devResourceId: string
  ) => Effect.Effect<void, FigmaCallError>
}

export class Figma extends Context.Tag(
  "@projectproject/backend/Services/Figma"
)<Figma, FigmaShape>() {}

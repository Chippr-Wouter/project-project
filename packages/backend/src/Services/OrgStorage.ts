import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type {
  ConnectStorageInput,
  Forbidden,
  NotFound,
  OrgStorageStatus,
  StorageAuthInvalid,
  StorageConfigMissing,
  StorageError,
  StorageNotConnected
} from "@projectproject/shared"
import type { S3Connection } from "./S3Storage"

export const maskAccessKeyId = (value: string): string => {
  if (value.length <= 4) return "*".repeat(value.length)
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`
}

export type OrgStorageConnectError =
  | NotFound
  | Forbidden
  | StorageAuthInvalid
  | StorageConfigMissing
  | StorageError

export interface OrgStorageShape {
  readonly getStatus: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<OrgStorageStatus, NotFound>
  readonly connect: (
    orgSlug: string,
    userId: string,
    input: ConnectStorageInput
  ) => Effect.Effect<OrgStorageStatus, OrgStorageConnectError>
  readonly disconnect: (
    orgSlug: string,
    userId: string
  ) => Effect.Effect<OrgStorageStatus, NotFound | Forbidden>
  readonly requireConnection: (
    orgSlug: string
  ) => Effect.Effect<S3Connection, StorageNotConnected | StorageConfigMissing>
}

export class OrgStorage extends Context.Service<OrgStorage, OrgStorageShape>()(
  "@projectproject/backend/Services/OrgStorage"
) {}

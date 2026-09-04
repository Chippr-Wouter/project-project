import * as Schema from "effect/Schema"

export const PersonalFigma = Schema.Struct({
  connected: Schema.Boolean,
  figmaUserId: Schema.NullOr(Schema.String),
  handle: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  lastVerifiedAt: Schema.NullOr(Schema.DateTimeUtc),
  lastCheckError: Schema.NullOr(Schema.String)
})
export type PersonalFigma = Schema.Schema.Type<typeof PersonalFigma>

export const FigmaProjectIntegrationStatus = Schema.Struct({
  connected: Schema.Boolean,
  handle: Schema.NullOr(Schema.String),
  connectedAt: Schema.NullOr(Schema.DateTimeUtc),
  lastCheckStatus: Schema.NullOr(Schema.Literal("ok", "error")),
  lastCheckError: Schema.NullOr(Schema.String),
  storageConnected: Schema.Boolean
})
export type FigmaProjectIntegrationStatus = Schema.Schema.Type<
  typeof FigmaProjectIntegrationStatus
>

export const ConnectFigmaProjectInput = Schema.Struct({
  accessToken: Schema.String.pipe(Schema.minLength(1))
})
export type ConnectFigmaProjectInput = Schema.Schema.Type<
  typeof ConnectFigmaProjectInput
>

export const FigmaLinkMetadata = Schema.Struct({
  fileKey: Schema.String,
  nodeId: Schema.NullOr(Schema.String),
  name: Schema.String,
  fileName: Schema.String,
  thumbnailUrl: Schema.NullOr(Schema.String),
  lastModified: Schema.NullOr(Schema.DateTimeUtc)
})
export type FigmaLinkMetadata = Schema.Schema.Type<typeof FigmaLinkMetadata>

import * as Schema from "effect/Schema"

export const OAuthApplication = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  clientId: Schema.String,
  createdAt: Schema.DateFromString,
  lastUsedAt: Schema.NullOr(Schema.DateFromString)
})
export type OAuthApplication = typeof OAuthApplication.Type

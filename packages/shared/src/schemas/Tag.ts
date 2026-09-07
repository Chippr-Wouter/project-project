import * as Schema from "effect/Schema"

export const TagName = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[a-z0-9][a-z0-9 -]{0,30}$/)),
  Schema.brand("TagName")
)
export type TagName = typeof TagName.Type

export const TagColor = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^#[0-9a-f]{6}$/i)),
  Schema.brand("TagColor")
)
export type TagColor = typeof TagColor.Type

export const Tag = Schema.Struct({
  name: TagName,
  color: TagColor,
  createdBy: Schema.String,
  createdAt: Schema.DateFromString
})
export type Tag = typeof Tag.Type

export const CreateTagInput = Schema.Struct({
  name: TagName,
  color: Schema.optional(TagColor)
})
export type CreateTagInput = typeof CreateTagInput.Type

export const UpdateTagInput = Schema.Struct({
  name: Schema.optional(TagName),
  color: Schema.optional(TagColor)
})
export type UpdateTagInput = typeof UpdateTagInput.Type

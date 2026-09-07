import * as Schema from "effect/Schema"
import {
  DEFAULT_TICKET_SORT,
  type AssigneeFilter,
  type GroupIdFilter,
  type SortDir,
  type SortKey,
  type TicketFilter,
  type TicketListQuery,
  type TicketSort
} from "./Ticket"
import { StatusSlug } from "../schemas/Status"

const MultiStringParam = Schema.optional(Schema.Array(Schema.String))

export const BaseTicketFilterParams = Schema.Struct({
  status: MultiStringParam,
  type: MultiStringParam,
  assignee: MultiStringParam,
  tags: MultiStringParam,
  groupId: MultiStringParam,
  hasBranch: Schema.optional(Schema.String),
  hasPr: Schema.optional(Schema.String),
  updatedAfter: Schema.optional(Schema.String),
  archived: Schema.optional(Schema.String),
  q: Schema.optional(Schema.String)
})

export const TicketListParams = Schema.extend(
  BaseTicketFilterParams,
  Schema.Struct({
    sort: Schema.optional(Schema.String),
    cursor: Schema.optional(Schema.String)
  })
)

export const TicketCountParams = BaseTicketFilterParams

export type TicketListParamsInput =
  | typeof TicketListParams.Type
  | { readonly [key: string]: unknown }
export type TicketCountParamsInput =
  | typeof TicketCountParams.Type
  | { readonly [key: string]: unknown }

const ASSIGNEE_UNASSIGNED_SENTINEL = "unassigned"
const GROUP_UNASSIGNED_SENTINEL = "unassigned"

const isStatusSlug = Schema.is(StatusSlug)
const TYPE_VALUES = ["feat", "bug", "chore", "other"] as const
const SORT_KEY_VALUES = [
  "id",
  "created",
  "updated",
  "title",
  "priority"
] as const
const SORT_DIR_VALUES = ["asc", "desc"] as const

const asArray = <T>(value: unknown): ReadonlyArray<T> | undefined => {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value as ReadonlyArray<T>
  return [value as T]
}

const decodeStatus = (value: unknown) => {
  const arr = asArray<string>(value)
  if (!arr) return undefined
  const filtered = arr.filter(isStatusSlug)
  return filtered.length === 0 ? undefined : filtered
}

const decodeType = (value: unknown) => {
  const arr = asArray<string>(value)
  if (!arr) return undefined
  const filtered = arr.filter((s): s is (typeof TYPE_VALUES)[number] =>
    (TYPE_VALUES as ReadonlyArray<string>).includes(s)
  )
  return filtered.length === 0 ? undefined : filtered
}

const decodeAssignee = (
  value: unknown
): ReadonlyArray<AssigneeFilter> | undefined => {
  const arr = asArray<string>(value)
  if (!arr) return undefined
  const mapped = arr.map((s): AssigneeFilter => {
    if (s === "mine") return "mine"
    if (s === ASSIGNEE_UNASSIGNED_SENTINEL) return null
    return s
  })
  return mapped.length === 0 ? undefined : mapped
}

const decodeStringArray = (
  value: unknown
): ReadonlyArray<string> | undefined => {
  const arr = asArray<string>(value)
  if (!arr) return undefined
  const filtered = arr.filter((s) => typeof s === "string" && s.length > 0)
  return filtered.length === 0 ? undefined : filtered
}

const GROUP_ID_PATTERN = /^G-[1-9][0-9]*$/
const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9 -]{0,30}$/

const decodeBranded = (
  value: unknown,
  pattern: RegExp
): ReadonlyArray<string> | undefined => {
  const arr = decodeStringArray(value)
  if (!arr) return undefined
  const filtered = arr.filter((s) => pattern.test(s))
  return filtered.length === 0 ? undefined : filtered
}

const decodeGroupId = (
  value: unknown
): ReadonlyArray<GroupIdFilter> | undefined => {
  const arr = decodeStringArray(value)
  if (!arr) return undefined
  const mapped: Array<GroupIdFilter> = []
  for (const s of arr) {
    if (s === GROUP_UNASSIGNED_SENTINEL) {
      mapped.push(null)
    } else if (GROUP_ID_PATTERN.test(s)) {
      mapped.push(s as GroupIdFilter)
    }
  }
  return mapped.length === 0 ? undefined : mapped
}

const decodeBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value
  if (value === "true") return true
  if (value === "false") return false
  return undefined
}

const decodeDate = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || value.length === 0) return undefined
  // @effect-diagnostics-next-line globalDate:off
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

const decodeSort = (value: unknown): TicketSort => {
  if (typeof value !== "string") return DEFAULT_TICKET_SORT
  const [keyRaw, dirRaw] = value.split(":")
  if (!keyRaw || !dirRaw) return DEFAULT_TICKET_SORT
  if (!(SORT_KEY_VALUES as ReadonlyArray<string>).includes(keyRaw)) {
    return DEFAULT_TICKET_SORT
  }
  if (!(SORT_DIR_VALUES as ReadonlyArray<string>).includes(dirRaw)) {
    return DEFAULT_TICKET_SORT
  }
  return { key: keyRaw as SortKey, dir: dirRaw as SortDir }
}

type MutableTicketFilter = {
  -readonly [K in keyof TicketFilter]: TicketFilter[K]
}

type MutableTicketListQuery = {
  -readonly [K in keyof TicketListQuery]: TicketListQuery[K]
}

export const ticketListQueryFromSearch = (
  search: TicketListParamsInput
): TicketListQuery => {
  const filter: Partial<MutableTicketFilter> = {}
  const status = decodeStatus(search.status)
  if (status) filter.status = status
  const type = decodeType(search.type)
  if (type) filter.type = type
  const assignee = decodeAssignee(search.assignee)
  if (assignee) filter.assignee = assignee
  const tags = decodeBranded(search.tags, TAG_NAME_PATTERN)
  if (tags) filter.tags = tags as TicketFilter["tags"]
  const groupId = decodeGroupId(search.groupId)
  if (groupId) filter.groupId = groupId
  const hasBranch = decodeBoolean(search.hasBranch)
  if (hasBranch !== undefined) filter.hasBranch = hasBranch
  const hasPr = decodeBoolean(search.hasPr)
  if (hasPr !== undefined) filter.hasPr = hasPr
  const updatedAfter = decodeDate(search.updatedAfter)
  if (updatedAfter !== undefined) filter.updatedAfter = updatedAfter
  const archived = decodeBoolean(search.archived)
  if (archived !== undefined) filter.archived = archived

  const out: MutableTicketListQuery = {
    sort: decodeSort(search.sort)
  }
  if (Object.keys(filter).length > 0) out.filter = filter as TicketFilter
  if (typeof search.q === "string" && search.q.length > 0) out.q = search.q
  if (typeof search.cursor === "string" && search.cursor.length > 0) {
    out.cursor = search.cursor
  }
  return out
}

const encodeAssignee = (
  values: ReadonlyArray<AssigneeFilter>
): ReadonlyArray<string> =>
  values.map((v) => (v === null ? ASSIGNEE_UNASSIGNED_SENTINEL : v))

const encodeGroupId = (
  values: ReadonlyArray<GroupIdFilter>
): ReadonlyArray<string> =>
  values.map((v) => (v === null ? GROUP_UNASSIGNED_SENTINEL : v))

const isDefaultSort = (sort: TicketSort) =>
  sort.key === DEFAULT_TICKET_SORT.key && sort.dir === DEFAULT_TICKET_SORT.dir

type TicketListQueryInput = {
  filter?: {
    status?: ReadonlyArray<StatusSlug>
    type?: ReadonlyArray<"feat" | "bug" | "chore" | "other">
    assignee?: ReadonlyArray<AssigneeFilter>
    tags?: ReadonlyArray<string>
    groupId?: ReadonlyArray<GroupIdFilter>
    hasBranch?: boolean
    hasPr?: boolean
    updatedAfter?: Date
    archived?: boolean
  }
  sort?: TicketSort
  q?: string
  cursor?: string
}

export const ticketListQueryToSearch = (
  query: TicketListQueryInput
): Record<string, string | ReadonlyArray<string>> => {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  const f = query.filter
  if (f) {
    if (f.status?.length) out.status = f.status
    if (f.type?.length) out.type = f.type
    if (f.assignee?.length) out.assignee = encodeAssignee(f.assignee)
    if (f.tags?.length) out.tags = f.tags
    if (f.groupId?.length) out.groupId = encodeGroupId(f.groupId)
    if (f.hasBranch !== undefined) out.hasBranch = String(f.hasBranch)
    if (f.hasPr !== undefined) out.hasPr = String(f.hasPr)
    if (f.updatedAfter) out.updatedAfter = f.updatedAfter.toISOString()
    if (f.archived !== undefined) out.archived = String(f.archived)
  }
  if (query.sort && !isDefaultSort(query.sort)) {
    out.sort = `${query.sort.key}:${query.sort.dir}`
  }
  if (query.q && query.q.length > 0) out.q = query.q
  if (query.cursor) out.cursor = query.cursor
  return out
}

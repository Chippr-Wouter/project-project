import type { EffectPgDatabase } from "drizzle-orm/effect-postgres"
import * as Context from "effect/Context"
import type { relations } from "../db/schema"

export class Db extends Context.Service<
  Db,
  EffectPgDatabase<typeof relations>
>()("@projectproject/backend/Services/Db") {}

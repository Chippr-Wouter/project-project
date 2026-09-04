// packages/backend/src/db/schema.ts
//
// THE DATABASE SCHEMA, AS TYPESCRIPT.
// ============================================================================
// drizzle-orm lets you describe Postgres tables as TypeScript values. The
// shape you write here drives three things:
//
//   1. The *generated SQL migrations* (`drizzle-kit generate` reads this file
//      and emits SQL into `src/db/migrations/`).
//   2. The *runtime types* of `db.select().from(projectIndex)` — Drizzle
//      infers what columns each row has, so a row from `projectIndex` is
//      `{ slug: string, ownerId: string, createdAt: Date }` in TypeScript.
//   3. The *insert/update/select APIs* — `db.insert(projectIndex).values({...})`
//      type-checks against this definition.
//
// IMPORTANT — what we put here, and what we don't.
// ----------------------------------------------------------------------------
// `docs/PROJECTPROJECT.md` is opinionated about this:
//
//   > Postgres holds only what *has* to be in a database: identity, sessions,
//   > and a thin index for fast project lookup. Everything else is markdown.
//
// So we declare *only* the `project_index` table here. There will be no
// `tickets` table, no `members` table, no `comments` table. Those live in
// markdown frontmatter.
//
// In Chapter 2 we'll let Better Auth's drizzle adapter add its own tables
// (users, sessions, accounts, verification_tokens) — those will appear in
// this same schema file via `import` of Better Auth's helpers, alongside the
// hand-written `projectIndex`.
//
// CHAPTER 1 GOAL
// ----------------------------------------------------------------------------
// Define `projectIndex` with three columns:
//
//   slug         text, primary key
//   ownerId      text, not null  — references users.id once Chapter 2 adds it
//   createdAt    timestamp, not null, defaults to now()
//
// Then run `bun run db:generate` to produce the first migration, and
// `bun run db:migrate` to apply it against the running Postgres.

import { defineRelations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core"
import type { OrgEverhourConfig } from "@projectproject/shared"

export * from "./auth-schema"
import { invitation, organization, user } from "./auth-schema"
import * as authSchema from "./auth-schema"

export type OrgIntegrationConfig = OrgEverhourConfig | Record<string, never>

export const projectIndex = pgTable(
  "project_index",
  {
    id: uuid("id").defaultRandom().notNull().unique(),
    slug: text("slug").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, {
        onDelete: "cascade"
      }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    icon: text("icon").notNull(),
    color: text("color").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    unique("project_index_id_organization_uidx").on(
      table.id,
      table.organizationId
    ),
    uniqueIndex("project_index_organization_key_uidx").on(
      table.organizationId,
      table.key
    ),
    uniqueIndex("project_index_slug_id_uidx").on(table.slug, table.id)
  ]
)

export const projectMember = pgTable(
  "project_member",
  {
    projectSlug: text("project_slug")
      .notNull()
      .references(() => projectIndex.slug, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projectIndex.id, {
      onDelete: "cascade"
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.projectSlug, table.userId] }),
    index("project_member_user_idx").on(table.userId)
  ]
)

export const projectInviteGrant = pgTable(
  "project_invite_grant",
  {
    invitationId: text("invitation_id")
      .notNull()
      .references(() => invitation.id, { onDelete: "cascade" }),
    projectSlug: text("project_slug").notNull(),
    projectId: uuid("project_id").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({ columns: [table.invitationId, table.projectSlug] }),
    foreignKey({
      name: "project_invite_grant_project_slug_id_fkey",
      columns: [table.projectSlug, table.projectId],
      foreignColumns: [projectIndex.slug, projectIndex.id]
    }).onDelete("cascade"),
    check(
      "project_invite_grant_role_check",
      sql`${table.role} in ('admin', 'member')`
    ),
    index("project_invite_grant_project_idx").on(table.projectSlug)
  ]
)

export const projectTag = pgTable(
  "project_tag",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectIndex.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.name] }),
    index("project_tag_project_idx").on(t.projectId)
  ]
)

export const projectStatus = pgTable(
  "project_status",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projectIndex.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    icon: text("icon").notNull(),
    color: text("color").notNull(),
    orderKey: text("order_key").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.slug] }),
    index("project_status_project_idx").on(t.projectId),
    index("project_status_order_idx").on(t.projectId, t.orderKey)
  ]
)

export const organizationIntegration = pgTable(
  "organization_integration",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: text("provider", {
      enum: ["github", "everhour", "s3", "figma"]
    }).notNull(),
    status: text("status", {
      enum: ["active", "disconnected", "broken"]
    }).notNull(),
    config: jsonb("config").$type<OrgIntegrationConfig>(),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckError: text("last_check_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique("organization_integration_id_org_uidx").on(t.id, t.organizationId),
    uniqueIndex("organization_integration_active_provider_uidx")
      .on(t.organizationId, t.provider)
      .where(sql`${t.status} = 'active'`),
    index("organization_integration_org_idx").on(t.organizationId)
  ]
)

export const organizationGithubIntegration = pgTable(
  "organization_github_integration",
  {
    organizationIntegrationId: uuid("organization_integration_id")
      .primaryKey()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    githubAccountId: text("github_account_id").notNull(),
    githubAccountLogin: text("github_account_login").notNull(),
    githubAccountType: text("github_account_type", {
      enum: ["User", "Organization"]
    }).notNull()
  },
  (t) => [
    uniqueIndex("organization_github_integration_installation_uidx").on(
      t.installationId
    )
  ]
)

export const organizationS3Integration = pgTable(
  "organization_s3_integration",
  {
    organizationIntegrationId: uuid("organization_integration_id")
      .primaryKey()
      .references(() => organizationIntegration.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    bucket: text("bucket").notNull(),
    region: text("region").notNull(),
    keyPrefix: text("key_prefix"),
    forcePathStyle: boolean("force_path_style").notNull().default(true),
    accessKeyId: text("access_key_id").notNull(),
    encryptedSecretKey: text("encrypted_secret_key").notNull(),
    secretKeyNonce: text("secret_key_nonce").notNull(),
    secretKeyTag: text("secret_key_tag").notNull()
  }
)

export const githubAppInstallSession = pgTable(
  "github_app_install_session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    returnProjectId: uuid("return_project_id"),
    returnProjectOrgId: text("return_project_org_id"),
    stateHash: text("state_hash").notNull().unique(),
    installationId: text("installation_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    foreignKey({
      name: "github_app_install_session_return_project_fkey",
      columns: [t.returnProjectId, t.returnProjectOrgId],
      foreignColumns: [projectIndex.id, projectIndex.organizationId]
    }).onDelete("set null"),
    index("github_app_install_session_org_idx").on(t.organizationId)
  ]
)

export const projectIntegrationLink = pgTable(
  "project_integration_link",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id").notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    organizationIntegrationId: uuid("organization_integration_id").notNull(),
    provider: text("provider", {
      enum: ["github", "everhour", "figma"]
    }).notNull(),
    status: text("status", {
      enum: ["active", "disconnected", "broken"]
    }).notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckError: text("last_check_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique("project_integration_link_id_org_uidx").on(t.id, t.organizationId),
    foreignKey({
      name: "project_integration_link_project_id_organization_id_fkey",
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projectIndex.id, projectIndex.organizationId]
    }).onDelete("cascade"),
    foreignKey({
      name: "project_integration_link_org_integration_id_organization_id_fke",
      columns: [t.organizationIntegrationId, t.organizationId],
      foreignColumns: [
        organizationIntegration.id,
        organizationIntegration.organizationId
      ]
    }).onDelete("cascade"),
    uniqueIndex("project_integration_link_active_provider_uidx")
      .on(t.projectId, t.provider)
      .where(sql`${t.status} = 'active'`),
    index("project_integration_link_project_idx").on(t.projectId),
    index("project_integration_link_org_integration_idx").on(
      t.organizationIntegrationId
    )
  ]
)

export const projectGithubRepository = pgTable(
  "project_github_repository",
  {
    projectIntegrationLinkId: uuid("project_integration_link_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["active", "disconnected", "broken"]
    }).notNull(),
    repoId: text("repo_id").notNull(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    defaultBranch: text("default_branch").notNull()
  },
  (t) => [
    foreignKey({
      name: "project_github_repository_link_id_organization_id_fkey",
      columns: [t.projectIntegrationLinkId, t.organizationId],
      foreignColumns: [
        projectIntegrationLink.id,
        projectIntegrationLink.organizationId
      ]
    }).onDelete("cascade"),
    uniqueIndex("project_github_repository_active_repo_uidx")
      .on(t.organizationId, t.repoId)
      .where(sql`${t.status} = 'active'`)
  ]
)

export const userEverhourIntegration = pgTable("user_everhour_integration", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  encryptedApiKey: text("encrypted_api_key").notNull(),
  apiKeyNonce: text("api_key_nonce").notNull(),
  apiKeyTag: text("api_key_tag").notNull(),
  everhourUserId: text("everhour_user_id").notNull(),
  name: text("name"),
  email: text("email"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
  lastCheckError: text("last_check_error")
})

export const projectEverhourIntegration = pgTable(
  "project_everhour_integration",
  {
    projectIntegrationLinkId: uuid("project_integration_link_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["active", "disconnected", "broken"]
    }).notNull(),
    everhourProjectId: text("everhour_project_id").notNull(),
    everhourProjectName: text("everhour_project_name").notNull(),
    backlogSectionId: text("backlog_section_id"),
    webhookId: text("webhook_id"),
    webhookSecret: text("webhook_secret"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastSyncStatus: text("last_sync_status", { enum: ["ok", "error"] }),
    lastSyncError: text("last_sync_error"),
    lastSyncActorUserId: text("last_sync_actor_user_id")
  },
  (t) => [
    foreignKey({
      name: "project_everhour_integration_link_id_organization_id_fkey",
      columns: [t.projectIntegrationLinkId, t.organizationId],
      foreignColumns: [
        projectIntegrationLink.id,
        projectIntegrationLink.organizationId
      ]
    }).onDelete("cascade"),
    uniqueIndex("project_everhour_integration_active_project_uidx")
      .on(t.organizationId, t.everhourProjectId)
      .where(sql`${t.status} = 'active'`)
  ]
)

export const everhourSectionLink = pgTable(
  "everhour_section_link",
  {
    projectIntegrationLinkId: uuid("project_integration_link_id").notNull(),
    localKey: text("local_key").notNull(),
    groupId: text("group_id"),
    everhourSectionId: text("everhour_section_id").notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["active", "archived", "broken"]
    }).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
  },
  (t) => [
    primaryKey({ columns: [t.projectIntegrationLinkId, t.localKey] }),
    foreignKey({
      name: "everhour_section_link_project_link_fkey",
      columns: [t.projectIntegrationLinkId],
      foreignColumns: [projectIntegrationLink.id]
    }).onDelete("cascade")
  ]
)

export const everhourWorkTypeTaskLink = pgTable(
  "everhour_work_type_task_link",
  {
    projectIntegrationLinkId: uuid("project_integration_link_id").notNull(),
    groupId: text("group_id").notNull(),
    workTypeKey: text("work_type_key").notNull(),
    everhourTaskId: text("everhour_task_id").notNull(),
    name: text("name").notNull(),
    status: text("status", {
      enum: ["active", "archived", "broken"]
    }).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
  },
  (t) => [
    primaryKey({
      columns: [t.projectIntegrationLinkId, t.groupId, t.workTypeKey]
    }),
    foreignKey({
      name: "everhour_work_type_task_link_project_link_fkey",
      columns: [t.projectIntegrationLinkId],
      foreignColumns: [projectIntegrationLink.id]
    }).onDelete("cascade")
  ]
)

export const everhourActiveTimer = pgTable(
  "everhour_active_timer",
  {
    everhourUserId: text("everhour_user_id").primaryKey(),
    userId: text("user_id").notNull(),
    projectIntegrationLinkId: uuid("project_integration_link_id").notNull(),
    ticketId: text("ticket_id"),
    groupId: text("group_id").notNull(),
    workTypeKey: text("work_type_key").notNull(),
    everhourTaskId: text("everhour_task_id").notNull(),
    everhourTimerId: text("everhour_timer_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull()
  },
  (t) => [
    foreignKey({
      name: "everhour_active_timer_project_link_fkey",
      columns: [t.projectIntegrationLinkId],
      foreignColumns: [projectIntegrationLink.id]
    }).onDelete("cascade"),
    index("everhour_active_timer_user_idx").on(t.userId)
  ]
)

export const everhourTimeAttribution = pgTable(
  "everhour_time_attribution",
  {
    everhourTimeId: text("everhour_time_id").primaryKey(),
    projectIntegrationLinkId: uuid("project_integration_link_id").notNull(),
    ticketId: text("ticket_id"),
    groupId: text("group_id").notNull(),
    workTypeKey: text("work_type_key").notNull(),
    everhourUserId: text("everhour_user_id").notNull(),
    userId: text("user_id").notNull(),
    seconds: integer("seconds").notNull(),
    date: text("date").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (t) => [
    foreignKey({
      name: "everhour_time_attribution_project_link_fkey",
      columns: [t.projectIntegrationLinkId],
      foreignColumns: [projectIntegrationLink.id]
    }).onDelete("cascade"),
    index("everhour_time_attribution_ticket_idx").on(
      t.projectIntegrationLinkId,
      t.ticketId
    )
  ]
)

export const ticketIndex = pgTable(
  "ticket_index",
  {
    organizationId: text("organization_id").notNull(),
    orgSlug: text("org_slug").notNull(),
    projectId: uuid("project_id").notNull(),
    projectSlug: text("project_slug").notNull(),
    ticketId: text("ticket_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull(),
    type: text("type", {
      enum: ["feat", "bug", "chore", "other"]
    }).notNull(),
    priority: text("priority", {
      enum: ["low", "med", "high"]
    }).notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    assignees: text("assignees")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    branch: text("branch"),
    pr: integer("pr"),
    prState: text("pr_state", { enum: ["open", "closed", "merged"] }),
    lastTransitionedPr: integer("last_transitioned_pr"),
    branchDeletedAt: timestamp("branch_deleted_at", { withTimezone: true }),
    checks: text("checks", {
      enum: ["passing", "failing", "pending", "neutral", "none"]
    }),
    checksHeadSha: text("checks_head_sha"),
    checksUpdatedAt: timestamp("checks_updated_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (t) => [
    primaryKey({
      columns: [t.projectId, t.ticketId]
    }),
    foreignKey({
      name: "ticket_index_project_slug_project_id_fkey",
      columns: [t.projectSlug, t.projectId],
      foreignColumns: [projectIndex.slug, projectIndex.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "ticket_index_project_id_organization_id_fkey",
      columns: [t.projectId, t.organizationId],
      foreignColumns: [projectIndex.id, projectIndex.organizationId]
    }).onDelete("cascade"),
    index("ticket_index_project_idx").on(t.organizationId, t.projectId),
    index("ticket_index_branch_idx").on(t.projectId, t.branch),
    index("ticket_index_updated_idx").on(t.projectId, t.updatedAt)
  ]
)

export const commentIndex = pgTable(
  "comment_index",
  {
    id: text("id").primaryKey(),
    projectSlug: text("project_slug").notNull(),
    ticketId: text("ticket_id").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true })
  },
  (t) => [
    index("comment_index_ticket_idx").on(t.projectSlug, t.ticketId, t.createdAt)
  ]
)

export const attachmentIndex = pgTable(
  "attachment_index",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    projectSlug: text("project_slug").notNull(),
    ticketId: text("ticket_id").notNull(),
    objectKey: text("object_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash"),
    status: text("status", { enum: ["pending", "live", "orphaned"] })
      .notNull()
      .default("pending"),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow(),
    committedAt: timestamp("committed_at", {
      withTimezone: true,
      precision: 3
    }),
    orphanedAt: timestamp("orphaned_at", { withTimezone: true, precision: 3 })
  },
  (t) => [
    index("attachment_index_ticket_idx").on(
      t.orgSlug,
      t.projectSlug,
      t.ticketId
    ),
    index("attachment_index_status_idx").on(t.status),
    index("attachment_index_org_idx").on(t.organizationId),
    index("attachment_index_org_created_idx").on(t.orgSlug, t.createdAt),
    index("attachment_index_org_size_idx").on(t.orgSlug, t.byteSize),
    index("attachment_index_object_key_idx").on(t.objectKey),
    index("attachment_index_dedupe_idx").on(
      t.orgSlug,
      t.contentHash,
      t.byteSize
    )
  ]
)

export const attachmentReference = pgTable(
  "attachment_reference",
  {
    attachmentId: text("attachment_id")
      .notNull()
      .references(() => attachmentIndex.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    projectSlug: text("project_slug").notNull(),
    ticketId: text("ticket_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.attachmentId, t.projectSlug, t.ticketId] }),
    index("attachment_reference_ticket_idx").on(
      t.orgSlug,
      t.projectSlug,
      t.ticketId
    )
  ]
)

export const userFigmaIntegration = pgTable("user_figma_integration", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  accessTokenNonce: text("access_token_nonce").notNull(),
  accessTokenTag: text("access_token_tag").notNull(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  refreshTokenNonce: text("refresh_token_nonce").notNull(),
  refreshTokenTag: text("refresh_token_tag").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  figmaUserId: text("figma_user_id").notNull(),
  handle: text("handle"),
  email: text("email"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
  lastCheckError: text("last_check_error")
})

export const projectFigmaIntegration = pgTable(
  "project_figma_integration",
  {
    projectIntegrationLinkId: uuid("project_integration_link_id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["active", "disconnected", "broken"]
    }).notNull(),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    accessTokenNonce: text("access_token_nonce").notNull(),
    accessTokenTag: text("access_token_tag").notNull(),
    handle: text("handle"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckError: text("last_check_error")
  },
  (t) => [
    foreignKey({
      name: "project_figma_integration_link_id_organization_id_fkey",
      columns: [t.projectIntegrationLinkId, t.organizationId],
      foreignColumns: [
        projectIntegrationLink.id,
        projectIntegrationLink.organizationId
      ]
    }).onDelete("cascade")
  ]
)

export const figmaLinkIndex = pgTable(
  "figma_link_index",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    fileKey: text("file_key").notNull(),
    nodeId: text("node_id"),
    kind: text("kind", {
      enum: ["design", "board", "slides", "proto"]
    }).notNull(),
    name: text("name"),
    fileName: text("file_name"),
    thumbnailKey: text("thumbnail_key"),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status", { enum: ["ok", "error"] }),
    lastCheckError: text("last_check_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (t) => [
    unique("figma_link_index_node_uidx")
      .on(t.orgSlug, t.fileKey, t.nodeId)
      .nullsNotDistinct(),
    index("figma_link_index_org_idx").on(t.organizationId),
    index("figma_link_index_file_idx").on(t.orgSlug, t.fileKey)
  ]
)

export const figmaReference = pgTable(
  "figma_reference",
  {
    linkId: text("link_id")
      .notNull()
      .references(() => figmaLinkIndex.id, { onDelete: "cascade" }),
    orgSlug: text("org_slug").notNull(),
    projectSlug: text("project_slug").notNull(),
    ticketId: text("ticket_id").notNull(),
    devResourceId: text("dev_resource_id"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
      .notNull()
      .defaultNow()
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.projectSlug, t.ticketId] }),
    index("figma_reference_ticket_idx").on(
      t.orgSlug,
      t.projectSlug,
      t.ticketId
    )
  ]

export const relations = defineRelations(
  {
    ...authSchema,
    userFigmaIntegration,
    projectFigmaIntegration,
    figmaLinkIndex,
    figmaReference,
    projectIndex,
    projectMember,
    projectInviteGrant,
    projectTag,
    projectStatus,
    organizationIntegration,
    organizationGithubIntegration,
    organizationS3Integration,
    githubAppInstallSession,
    projectIntegrationLink,
    projectGithubRepository,
    userEverhourIntegration,
    projectEverhourIntegration,
    everhourSectionLink,
    everhourWorkTypeTaskLink,
    everhourActiveTimer,
    everhourTimeAttribution,
    ticketIndex,
    commentIndex,
    attachmentIndex,
    attachmentReference
  },
  (r) => ({
    projectIndex: {
      organization: r.one.organization({
        optional: false,
        from: [r.projectIndex.organizationId],
        to: [r.organization.id]
      }),
      members: r.many.projectMember(),
      inviteGrants: r.many.projectInviteGrant(),
      tags: r.many.projectTag(),
      statuses: r.many.projectStatus(),
      integrationLinks: r.many.projectIntegrationLink()
    },
    projectMember: {
      project: r.one.projectIndex({
        optional: false,
        from: [r.projectMember.projectSlug],
        to: [r.projectIndex.slug]
      }),
      user: r.one.user({
        optional: false,
        from: [r.projectMember.userId],
        to: [r.user.id]
      })
    },
    projectInviteGrant: {
      invitation: r.one.invitation({
        optional: false,
        from: [r.projectInviteGrant.invitationId],
        to: [r.invitation.id]
      }),
      project: r.one.projectIndex({
        optional: false,
        from: [r.projectInviteGrant.projectSlug],
        to: [r.projectIndex.slug]
      })
    },
    projectTag: {
      project: r.one.projectIndex({
        optional: false,
        from: [r.projectTag.projectId],
        to: [r.projectIndex.id]
      }),
      createdByUser: r.one.user({
        optional: false,
        from: [r.projectTag.createdBy],
        to: [r.user.id]
      })
    },
    projectStatus: {
      project: r.one.projectIndex({
        optional: false,
        from: [r.projectStatus.projectId],
        to: [r.projectIndex.id]
      }),
      createdByUser: r.one.user({
        optional: false,
        from: [r.projectStatus.createdBy],
        to: [r.user.id]
      })
    },
    organizationIntegration: {
      organization: r.one.organization({
        optional: false,
        from: [r.organizationIntegration.organizationId],
        to: [r.organization.id]
      }),
      github: r.one.organizationGithubIntegration(),
      projectLinks: r.many.projectIntegrationLink()
    },
    githubAppInstallSession: {
      organization: r.one.organization({
        optional: false,
        from: [r.githubAppInstallSession.organizationId],
        to: [r.organization.id]
      }),
      user: r.one.user({
        optional: false,
        from: [r.githubAppInstallSession.userId],
        to: [r.user.id]
      }),
      returnProject: r.one.projectIndex({
        from: [
          r.githubAppInstallSession.returnProjectId,
          r.githubAppInstallSession.returnProjectOrgId
        ],
        to: [r.projectIndex.id, r.projectIndex.organizationId]
      })
    },
    organizationGithubIntegration: {
      integration: r.one.organizationIntegration({
        optional: false,
        from: [r.organizationGithubIntegration.organizationIntegrationId],
        to: [r.organizationIntegration.id]
      })
    },
    projectIntegrationLink: {
      project: r.one.projectIndex({
        optional: false,
        from: [r.projectIntegrationLink.projectId],
        to: [r.projectIndex.id]
      }),
      organization: r.one.organization({
        optional: false,
        from: [r.projectIntegrationLink.organizationId],
        to: [r.organization.id]
      }),
      organizationIntegration: r.one.organizationIntegration({
        optional: false,
        from: [r.projectIntegrationLink.organizationIntegrationId],
        to: [r.organizationIntegration.id]
      }),
      githubRepository: r.one.projectGithubRepository(),
      everhourIntegration: r.one.projectEverhourIntegration()
    },
    projectGithubRepository: {
      projectLink: r.one.projectIntegrationLink({
        optional: false,
        from: [r.projectGithubRepository.projectIntegrationLinkId],
        to: [r.projectIntegrationLink.id]
      })
    },
    userEverhourIntegration: {
      user: r.one.user({
        optional: false,
        from: [r.userEverhourIntegration.userId],
        to: [r.user.id]
      })
    },
    projectEverhourIntegration: {
      projectLink: r.one.projectIntegrationLink({
        optional: false,
        from: [r.projectEverhourIntegration.projectIntegrationLinkId],
        to: [r.projectIntegrationLink.id]
      })
    },
    commentIndex: {
      author: r.one.user({
        optional: false,
        from: [r.commentIndex.authorId],
        to: [r.user.id]
      })
    },
    user: {
      sessions: r.many.session(),
      accounts: r.many.account(),
      members: r.many.member(),
      invitations: r.many.invitation(),
      oauthClients: r.many.oauthClient(),
      oauthAccessTokens: r.many.oauthAccessToken(),
      oauthConsents: r.many.oauthConsent()
    },
    session: {
      user: r.one.user({
        optional: false,
        from: [r.session.userId],
        to: [r.user.id]
      })
    },
    account: {
      user: r.one.user({
        optional: false,
        from: [r.account.userId],
        to: [r.user.id]
      })
    },
    organization: {
      members: r.many.member(),
      invitations: r.many.invitation()
    },
    member: {
      organization: r.one.organization({
        optional: false,
        from: [r.member.organizationId],
        to: [r.organization.id]
      }),
      user: r.one.user({
        optional: false,
        from: [r.member.userId],
        to: [r.user.id]
      })
    },
    invitation: {
      organization: r.one.organization({
        optional: false,
        from: [r.invitation.organizationId],
        to: [r.organization.id]
      }),
      user: r.one.user({
        optional: false,
        from: [r.invitation.inviterId],
        to: [r.user.id]
      })
    },
    oauthClient: {
      user: r.one.user({
        from: [r.oauthClient.userId],
        to: [r.user.id]
      }),
      oauthAccessTokens: r.many.oauthAccessToken(),
      oauthConsents: r.many.oauthConsent()
    },
    oauthAccessToken: {
      oauthClient: r.one.oauthClient({
        optional: false,
        from: [r.oauthAccessToken.clientId],
        to: [r.oauthClient.clientId]
      }),
      user: r.one.user({
        from: [r.oauthAccessToken.userId],
        to: [r.user.id]
      })
    },
    oauthConsent: {
      oauthClient: r.one.oauthClient({
        optional: false,
        from: [r.oauthConsent.clientId],
        to: [r.oauthClient.clientId]
      }),
      user: r.one.user({
        from: [r.oauthConsent.userId],
        to: [r.user.id]
      })
    }
  })
)

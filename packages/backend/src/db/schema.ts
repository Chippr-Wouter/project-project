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

import { relations, sql } from "drizzle-orm"
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
    nextTicketNumber: integer("next_ticket_number").notNull().default(1),
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
      enum: ["github", "everhour", "s3"]
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
    provider: text("provider", { enum: ["github", "everhour"] }).notNull(),
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
      name: "project_integration_link_org_integration_id_organization_id_fkey",
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

export const projectIndexRelations = relations(
  projectIndex,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [projectIndex.organizationId],
      references: [organization.id]
    }),
    members: many(projectMember),
    inviteGrants: many(projectInviteGrant),
    tags: many(projectTag),
    statuses: many(projectStatus),
    integrationLinks: many(projectIntegrationLink)
  })
)

export const projectMemberRelations = relations(projectMember, ({ one }) => ({
  project: one(projectIndex, {
    fields: [projectMember.projectSlug],
    references: [projectIndex.slug]
  }),
  user: one(user, {
    fields: [projectMember.userId],
    references: [user.id]
  })
}))

export const projectInviteGrantRelations = relations(
  projectInviteGrant,
  ({ one }) => ({
    invitation: one(invitation, {
      fields: [projectInviteGrant.invitationId],
      references: [invitation.id]
    }),
    project: one(projectIndex, {
      fields: [projectInviteGrant.projectSlug],
      references: [projectIndex.slug]
    })
  })
)

export const projectTagRelations = relations(projectTag, ({ one }) => ({
  project: one(projectIndex, {
    fields: [projectTag.projectId],
    references: [projectIndex.id]
  }),
  createdByUser: one(user, {
    fields: [projectTag.createdBy],
    references: [user.id]
  })
}))

export const projectStatusRelations = relations(projectStatus, ({ one }) => ({
  project: one(projectIndex, {
    fields: [projectStatus.projectId],
    references: [projectIndex.id]
  }),
  createdByUser: one(user, {
    fields: [projectStatus.createdBy],
    references: [user.id]
  })
}))

export const organizationIntegrationRelations = relations(
  organizationIntegration,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationIntegration.organizationId],
      references: [organization.id]
    }),
    github: one(organizationGithubIntegration),
    projectLinks: many(projectIntegrationLink)
  })
)

export const githubAppInstallSessionRelations = relations(
  githubAppInstallSession,
  ({ one }) => ({
    organization: one(organization, {
      fields: [githubAppInstallSession.organizationId],
      references: [organization.id]
    }),
    user: one(user, {
      fields: [githubAppInstallSession.userId],
      references: [user.id]
    }),
    returnProject: one(projectIndex, {
      fields: [
        githubAppInstallSession.returnProjectId,
        githubAppInstallSession.returnProjectOrgId
      ],
      references: [projectIndex.id, projectIndex.organizationId]
    })
  })
)

export const organizationGithubIntegrationRelations = relations(
  organizationGithubIntegration,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [organizationGithubIntegration.organizationIntegrationId],
      references: [organizationIntegration.id]
    })
  })
)

export const projectIntegrationLinkRelations = relations(
  projectIntegrationLink,
  ({ one }) => ({
    project: one(projectIndex, {
      fields: [projectIntegrationLink.projectId],
      references: [projectIndex.id]
    }),
    organization: one(organization, {
      fields: [projectIntegrationLink.organizationId],
      references: [organization.id]
    }),
    organizationIntegration: one(organizationIntegration, {
      fields: [projectIntegrationLink.organizationIntegrationId],
      references: [organizationIntegration.id]
    }),
    githubRepository: one(projectGithubRepository),
    everhourIntegration: one(projectEverhourIntegration)
  })
)

export const projectGithubRepositoryRelations = relations(
  projectGithubRepository,
  ({ one }) => ({
    projectLink: one(projectIntegrationLink, {
      fields: [projectGithubRepository.projectIntegrationLinkId],
      references: [projectIntegrationLink.id]
    })
  })
)

export const userEverhourIntegrationRelations = relations(
  userEverhourIntegration,
  ({ one }) => ({
    user: one(user, {
      fields: [userEverhourIntegration.userId],
      references: [user.id]
    })
  })
)

export const projectEverhourIntegrationRelations = relations(
  projectEverhourIntegration,
  ({ one }) => ({
    projectLink: one(projectIntegrationLink, {
      fields: [projectEverhourIntegration.projectIntegrationLinkId],
      references: [projectIntegrationLink.id]
    })
  })
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

export const commentIndexRelations = relations(commentIndex, ({ one }) => ({
  author: one(user, {
    fields: [commentIndex.authorId],
    references: [user.id]
  })
}))

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

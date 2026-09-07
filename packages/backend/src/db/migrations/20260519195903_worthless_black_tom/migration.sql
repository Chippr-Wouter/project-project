CREATE TABLE "github_app_install_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"return_project_id" uuid,
	"return_project_org_id" text,
	"state_hash" text NOT NULL,
	"installation_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_install_session_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_github_integration" (
	"organization_integration_id" uuid PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"github_account_id" text NOT NULL,
	"github_account_login" text NOT NULL,
	"github_account_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_integration" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_integration_id_org_uidx" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "project_github_repository" (
	"project_integration_link_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"repo_id" text NOT NULL,
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"default_branch" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_integration_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"organization_integration_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_integration_link_id_org_uidx" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "github_app_install_session" ADD CONSTRAINT "github_app_install_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_install_session" ADD CONSTRAINT "github_app_install_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_app_install_session" ADD CONSTRAINT "github_app_install_session_return_project_fkey" FOREIGN KEY ("return_project_id","return_project_org_id") REFERENCES "public"."project_index"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_github_integration" ADD CONSTRAINT "organization_github_integration_organization_integration_id_organization_integration_id_fk" FOREIGN KEY ("organization_integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integration" ADD CONSTRAINT "organization_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_repository" ADD CONSTRAINT "project_github_repository_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_github_repository" ADD CONSTRAINT "project_github_repository_link_id_organization_id_fkey" FOREIGN KEY ("project_integration_link_id","organization_id") REFERENCES "public"."project_integration_link"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integration_link" ADD CONSTRAINT "project_integration_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integration_link" ADD CONSTRAINT "project_integration_link_project_id_organization_id_fkey" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project_index"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_integration_link" ADD CONSTRAINT "project_integration_link_org_integration_id_organization_id_fkey" FOREIGN KEY ("organization_integration_id","organization_id") REFERENCES "public"."organization_integration"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_app_install_session_org_idx" ON "github_app_install_session" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_github_integration_installation_uidx" ON "organization_github_integration" USING btree ("installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_integration_active_provider_uidx" ON "organization_integration" USING btree ("organization_id","provider") WHERE "organization_integration"."status" = 'active';--> statement-breakpoint
CREATE INDEX "organization_integration_org_idx" ON "organization_integration" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_github_repository_active_repo_uidx" ON "project_github_repository" USING btree ("organization_id","repo_id") WHERE "project_github_repository"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "project_integration_link_active_provider_uidx" ON "project_integration_link" USING btree ("project_id","provider") WHERE "project_integration_link"."status" = 'active';--> statement-breakpoint
CREATE INDEX "project_integration_link_project_idx" ON "project_integration_link" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_integration_link_org_integration_idx" ON "project_integration_link" USING btree ("organization_integration_id");
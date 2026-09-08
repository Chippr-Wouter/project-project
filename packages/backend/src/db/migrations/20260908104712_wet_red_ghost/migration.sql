CREATE TABLE "figma_link_index" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"org_slug" text NOT NULL,
	"file_key" text NOT NULL,
	"node_id" text,
	"kind" text NOT NULL,
	"name" text,
	"file_name" text,
	"thumbnail_key" text,
	"last_modified" timestamp with time zone,
	"fetched_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "figma_link_index_node_uidx" UNIQUE NULLS NOT DISTINCT("org_slug","file_key","node_id")
);
--> statement-breakpoint
CREATE TABLE "figma_reference" (
	"link_id" text,
	"org_slug" text NOT NULL,
	"project_slug" text,
	"ticket_id" text,
	"dev_resource_id" text,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "figma_reference_pkey" PRIMARY KEY("link_id","project_slug","ticket_id")
);
--> statement-breakpoint
CREATE TABLE "project_figma_integration" (
	"project_integration_link_id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"encrypted_access_token" text NOT NULL,
	"access_token_nonce" text NOT NULL,
	"access_token_tag" text NOT NULL,
	"handle" text,
	"last_checked_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_error" text
);
--> statement-breakpoint
CREATE TABLE "user_figma_integration" (
	"user_id" text PRIMARY KEY,
	"encrypted_access_token" text NOT NULL,
	"access_token_nonce" text NOT NULL,
	"access_token_tag" text NOT NULL,
	"encrypted_refresh_token" text NOT NULL,
	"refresh_token_nonce" text NOT NULL,
	"refresh_token_tag" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"figma_user_id" text NOT NULL,
	"handle" text,
	"email" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_error" text
);
--> statement-breakpoint
CREATE TABLE "user_figma_oauth_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"state_hash" text NOT NULL UNIQUE,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "figma_link_index_org_idx" ON "figma_link_index" ("organization_id");--> statement-breakpoint
CREATE INDEX "figma_link_index_file_idx" ON "figma_link_index" ("org_slug","file_key");--> statement-breakpoint
CREATE INDEX "figma_reference_ticket_idx" ON "figma_reference" ("org_slug","project_slug","ticket_id");--> statement-breakpoint
CREATE INDEX "user_figma_oauth_state_user_idx" ON "user_figma_oauth_state" ("user_id");--> statement-breakpoint
ALTER TABLE "figma_link_index" ADD CONSTRAINT "figma_link_index_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "figma_reference" ADD CONSTRAINT "figma_reference_link_id_figma_link_index_id_fkey" FOREIGN KEY ("link_id") REFERENCES "figma_link_index"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_figma_integration" ADD CONSTRAINT "project_figma_integration_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_figma_integration" ADD CONSTRAINT "project_figma_integration_link_id_organization_id_fkey" FOREIGN KEY ("project_integration_link_id","organization_id") REFERENCES "project_integration_link"("id","organization_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_figma_integration" ADD CONSTRAINT "user_figma_integration_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_figma_oauth_state" ADD CONSTRAINT "user_figma_oauth_state_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
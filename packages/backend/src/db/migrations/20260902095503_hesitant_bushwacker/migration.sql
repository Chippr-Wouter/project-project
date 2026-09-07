CREATE TABLE "attachment_index" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"org_slug" text NOT NULL,
	"project_slug" text NOT NULL,
	"ticket_id" text NOT NULL,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"orphaned_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organization_s3_integration" (
	"organization_integration_id" uuid PRIMARY KEY NOT NULL,
	"endpoint" text NOT NULL,
	"bucket" text NOT NULL,
	"region" text NOT NULL,
	"key_prefix" text,
	"force_path_style" boolean DEFAULT true NOT NULL,
	"access_key_id" text NOT NULL,
	"encrypted_secret_key" text NOT NULL,
	"secret_key_nonce" text NOT NULL,
	"secret_key_tag" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment_index" ADD CONSTRAINT "attachment_index_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_s3_integration" ADD CONSTRAINT "organization_s3_integration_organization_integration_id_organization_integration_id_fk" FOREIGN KEY ("organization_integration_id") REFERENCES "public"."organization_integration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_index_ticket_idx" ON "attachment_index" USING btree ("org_slug","project_slug","ticket_id");--> statement-breakpoint
CREATE INDEX "attachment_index_status_idx" ON "attachment_index" USING btree ("status");--> statement-breakpoint
CREATE INDEX "attachment_index_org_idx" ON "attachment_index" USING btree ("organization_id");
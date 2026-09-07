CREATE TABLE "everhour_active_timer" (
	"everhour_user_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_integration_link_id" uuid NOT NULL,
	"ticket_id" text,
	"group_id" text NOT NULL,
	"work_type_key" text NOT NULL,
	"everhour_task_id" text NOT NULL,
	"everhour_timer_id" text,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "everhour_section_link" (
	"project_integration_link_id" uuid NOT NULL,
	"local_key" text NOT NULL,
	"group_id" text,
	"everhour_section_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "everhour_section_link_project_integration_link_id_local_key_pk" PRIMARY KEY("project_integration_link_id","local_key")
);
--> statement-breakpoint
CREATE TABLE "everhour_time_attribution" (
	"everhour_time_id" text PRIMARY KEY NOT NULL,
	"project_integration_link_id" uuid NOT NULL,
	"ticket_id" text,
	"group_id" text NOT NULL,
	"work_type_key" text NOT NULL,
	"everhour_user_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seconds" integer NOT NULL,
	"date" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "everhour_work_type_task_link" (
	"project_integration_link_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"work_type_key" text NOT NULL,
	"everhour_task_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "everhour_work_type_task_link_project_integration_link_id_group_id_work_type_key_pk" PRIMARY KEY("project_integration_link_id","group_id","work_type_key")
);
--> statement-breakpoint
CREATE TABLE "project_everhour_integration" (
	"project_integration_link_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"status" text NOT NULL,
	"everhour_project_id" text NOT NULL,
	"everhour_project_name" text NOT NULL,
	"backlog_section_id" text,
	"webhook_id" text,
	"webhook_secret" text,
	"last_synced_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_error" text,
	"last_sync_actor_user_id" text
);
--> statement-breakpoint
CREATE TABLE "user_everhour_integration" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted_api_key" text NOT NULL,
	"api_key_nonce" text NOT NULL,
	"api_key_tag" text NOT NULL,
	"everhour_user_id" text NOT NULL,
	"name" text,
	"email" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_check_status" text,
	"last_check_error" text
);
--> statement-breakpoint
ALTER TABLE "organization_integration" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "everhour_active_timer" ADD CONSTRAINT "everhour_active_timer_project_link_fkey" FOREIGN KEY ("project_integration_link_id") REFERENCES "public"."project_integration_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "everhour_section_link" ADD CONSTRAINT "everhour_section_link_project_link_fkey" FOREIGN KEY ("project_integration_link_id") REFERENCES "public"."project_integration_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "everhour_time_attribution" ADD CONSTRAINT "everhour_time_attribution_project_link_fkey" FOREIGN KEY ("project_integration_link_id") REFERENCES "public"."project_integration_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "everhour_work_type_task_link" ADD CONSTRAINT "everhour_work_type_task_link_project_link_fkey" FOREIGN KEY ("project_integration_link_id") REFERENCES "public"."project_integration_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_everhour_integration" ADD CONSTRAINT "project_everhour_integration_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_everhour_integration" ADD CONSTRAINT "project_everhour_integration_link_id_organization_id_fkey" FOREIGN KEY ("project_integration_link_id","organization_id") REFERENCES "public"."project_integration_link"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_everhour_integration" ADD CONSTRAINT "user_everhour_integration_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "everhour_active_timer_user_idx" ON "everhour_active_timer" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "everhour_time_attribution_ticket_idx" ON "everhour_time_attribution" USING btree ("project_integration_link_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_everhour_integration_active_project_uidx" ON "project_everhour_integration" USING btree ("organization_id","everhour_project_id") WHERE "project_everhour_integration"."status" = 'active';
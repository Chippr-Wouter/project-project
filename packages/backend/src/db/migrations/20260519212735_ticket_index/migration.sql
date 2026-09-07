CREATE TABLE "ticket_index" (
	"organization_id" text NOT NULL,
	"org_slug" text NOT NULL,
	"project_id" uuid NOT NULL,
	"project_slug" text NOT NULL,
	"ticket_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"type" text NOT NULL,
	"priority" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"assignees" text[] DEFAULT '{}'::text[] NOT NULL,
	"branch" text,
	"pr" integer,
	"pr_state" text,
	"last_transitioned_pr" integer,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ticket_index_project_id_ticket_id_pk" PRIMARY KEY("project_id","ticket_id")
);
--> statement-breakpoint
ALTER TABLE "ticket_index" ADD CONSTRAINT "ticket_index_project_slug_project_id_fkey" FOREIGN KEY ("project_slug","project_id") REFERENCES "public"."project_index"("slug","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_index" ADD CONSTRAINT "ticket_index_project_id_organization_id_fkey" FOREIGN KEY ("project_id","organization_id") REFERENCES "public"."project_index"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_index_project_idx" ON "ticket_index" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "ticket_index_branch_idx" ON "ticket_index" USING btree ("project_id","branch");--> statement-breakpoint
CREATE INDEX "ticket_index_updated_idx" ON "ticket_index" USING btree ("project_id","updated_at");
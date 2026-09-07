CREATE TABLE "project_status" (
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"icon" text NOT NULL,
	"color" text NOT NULL,
	"order_key" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_status_project_id_slug_pk" PRIMARY KEY("project_id","slug")
);
--> statement-breakpoint
ALTER TABLE "project_status" ADD CONSTRAINT "project_status_project_id_project_index_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_index"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_status" ADD CONSTRAINT "project_status_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_status_project_idx" ON "project_status" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_status_order_idx" ON "project_status" USING btree ("project_id","order_key");

INSERT INTO "project_status" ("project_id", "slug", "label", "icon", "color", "order_key", "created_by", "created_at")
SELECT
  pi."id",
  baseline.slug,
  baseline.label,
  baseline.icon,
  baseline.color,
  baseline.order_key,
  pi."created_by",
  NOW()
FROM "project_index" pi
CROSS JOIN (VALUES
  ('todo',        'Todo',        'Circle',       '#a3a3a3', 'a0'),
  ('in_progress', 'In progress', 'CircleDot',    '#3b82f6', 'a1'),
  ('done',        'Done',        'CheckCircle2', '#22c55e', 'a2')
) AS baseline(slug, label, icon, color, order_key)
ON CONFLICT ("project_id", "slug") DO NOTHING;
CREATE TABLE "attachment_reference" (
	"attachment_id" text NOT NULL,
	"org_slug" text NOT NULL,
	"project_slug" text NOT NULL,
	"ticket_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_reference_attachment_id_project_slug_ticket_id_pk" PRIMARY KEY("attachment_id","project_slug","ticket_id")
);
--> statement-breakpoint
ALTER TABLE "attachment_reference" ADD CONSTRAINT "attachment_reference_attachment_id_attachment_index_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachment_index"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_reference_ticket_idx" ON "attachment_reference" USING btree ("org_slug","project_slug","ticket_id");--> statement-breakpoint
INSERT INTO "attachment_reference" ("attachment_id", "org_slug", "project_slug", "ticket_id", "created_at")
SELECT "id", "org_slug", "project_slug", "ticket_id", COALESCE("committed_at", "created_at")
FROM "attachment_index"
WHERE "status" = 'live'
ON CONFLICT DO NOTHING;

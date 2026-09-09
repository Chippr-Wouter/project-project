CREATE TABLE "project_image_reference" (
	"project_slug" text,
	"org_slug" text NOT NULL,
	"attachment_id" text NOT NULL,
	"slot" text,
	CONSTRAINT "project_image_reference_pkey" PRIMARY KEY("project_slug","slot")
);
--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "ticket_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "project_image_reference_attachment_idx" ON "project_image_reference" ("attachment_id");--> statement-breakpoint
ALTER TABLE "project_image_reference" ADD CONSTRAINT "project_image_reference_project_slug_project_index_slug_fkey" FOREIGN KEY ("project_slug") REFERENCES "project_index"("slug") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_image_reference" ADD CONSTRAINT "project_image_reference_attachment_id_attachment_index_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachment_index"("id") ON DELETE RESTRICT;
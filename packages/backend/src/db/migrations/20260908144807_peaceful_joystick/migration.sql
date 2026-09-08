ALTER TABLE "figma_link_index" ADD COLUMN "orphaned_at" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "committed_at" SET DATA TYPE timestamp(3) with time zone USING "committed_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "orphaned_at" SET DATA TYPE timestamp(3) with time zone USING "orphaned_at"::timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "attachment_reference" ALTER COLUMN "created_at" SET DATA TYPE timestamp(3) with time zone USING "created_at"::timestamp(3) with time zone;--> statement-breakpoint
DELETE FROM "figma_reference" WHERE NOT EXISTS (SELECT 1 FROM "project_index" WHERE "project_index"."slug" = "figma_reference"."project_slug");--> statement-breakpoint
ALTER TABLE "figma_reference" ADD CONSTRAINT "figma_reference_project_slug_project_index_slug_fkey" FOREIGN KEY ("project_slug") REFERENCES "project_index"("slug") ON DELETE CASCADE;

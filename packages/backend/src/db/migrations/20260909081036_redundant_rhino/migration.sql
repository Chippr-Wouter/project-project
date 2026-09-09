ALTER TABLE "figma_link_index" ADD COLUMN "project_slug" text NOT NULL;--> statement-breakpoint
DROP INDEX "figma_link_index_file_idx";--> statement-breakpoint
CREATE INDEX "figma_link_index_file_idx" ON "figma_link_index" ("project_slug","file_key");--> statement-breakpoint
ALTER TABLE "figma_link_index" DROP CONSTRAINT "figma_link_index_node_uidx";--> statement-breakpoint
ALTER TABLE "figma_link_index" ADD CONSTRAINT "figma_link_index_node_uidx" UNIQUE NULLS NOT DISTINCT("project_slug","file_key","node_id");--> statement-breakpoint
ALTER TABLE "figma_link_index" ADD CONSTRAINT "figma_link_index_project_slug_project_index_slug_fkey" FOREIGN KEY ("project_slug") REFERENCES "project_index"("slug") ON DELETE CASCADE;

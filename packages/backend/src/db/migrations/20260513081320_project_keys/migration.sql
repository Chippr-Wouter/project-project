ALTER TABLE "project_index" ADD COLUMN "key" text;--> statement-breakpoint
UPDATE "project_index" SET "key" = 'T' WHERE "slug" = 'project-project';--> statement-breakpoint
WITH numbered AS (
	SELECT "slug", row_number() OVER (ORDER BY "slug") AS n
	FROM "project_index"
	WHERE "slug" <> 'project-project'
)
UPDATE "project_index"
SET "key" = 'P' || numbered.n::text
FROM numbered
WHERE "project_index"."slug" = numbered."slug";--> statement-breakpoint
ALTER TABLE "project_index" ALTER COLUMN "key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_index" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_index_organization_key_uidx" ON "project_index" USING btree ("organization_id","key");

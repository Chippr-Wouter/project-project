ALTER TABLE "attachment_index" ALTER COLUMN "created_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "created_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "committed_at" SET DATA TYPE timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "attachment_index" ALTER COLUMN "orphaned_at" SET DATA TYPE timestamp (3) with time zone;
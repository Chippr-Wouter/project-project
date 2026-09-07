ALTER TABLE "ticket_index" ADD COLUMN "checks" text;--> statement-breakpoint
ALTER TABLE "ticket_index" ADD COLUMN "checks_head_sha" text;--> statement-breakpoint
ALTER TABLE "ticket_index" ADD COLUMN "checks_updated_at" timestamp with time zone;
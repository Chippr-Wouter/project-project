ALTER TABLE "project_index" ADD COLUMN "next_ticket_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE "project_index"
SET "next_ticket_number" = COALESCE(
	(
		SELECT MAX(split_part("ticket_id", '-', -1)::integer) + 1
		FROM "ticket_index"
		WHERE "ticket_index"."project_id" = "project_index"."id"
		  AND split_part("ticket_id", '-', -1) ~ '^[0-9]+$'
	),
	1
);

CREATE TABLE "comment_index" (
	"id" text PRIMARY KEY NOT NULL,
	"project_slug" text NOT NULL,
	"ticket_id" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "comment_index" ADD CONSTRAINT "comment_index_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_index_ticket_idx" ON "comment_index" USING btree ("project_slug","ticket_id","created_at");
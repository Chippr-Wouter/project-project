CREATE TABLE "user_figma_oauth_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_figma_oauth_state_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "user_figma_oauth_state" ADD CONSTRAINT "user_figma_oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_figma_oauth_state_user_idx" ON "user_figma_oauth_state" USING btree ("user_id");
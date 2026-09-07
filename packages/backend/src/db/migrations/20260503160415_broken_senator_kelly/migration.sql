CREATE TABLE "project_member" (
	"project_slug" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_slug_user_id_pk" PRIMARY KEY("project_slug","user_id")
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_slug_project_index_slug_fk" FOREIGN KEY ("project_slug") REFERENCES "public"."project_index"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_member_user_idx" ON "project_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_username_unique" UNIQUE("username");
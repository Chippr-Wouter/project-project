CREATE TABLE "project_tag" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_tag_project_id_name_pk" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
ALTER TABLE "project_tag" ADD CONSTRAINT "project_tag_project_id_project_index_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_index"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tag" ADD CONSTRAINT "project_tag_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_tag_project_idx" ON "project_tag" USING btree ("project_id");
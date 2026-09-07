CREATE TABLE "project_index" (
	"slug" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

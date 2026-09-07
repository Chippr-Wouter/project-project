CREATE TABLE "project_invite_grant" (
	"invitation_id" text NOT NULL,
	"project_slug" text NOT NULL,
	"project_id" uuid NOT NULL,
	"role" text NOT NULL CHECK ("role" IN ('admin', 'member')),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_invite_grant_invitation_id_project_slug_pk" PRIMARY KEY("invitation_id","project_slug")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "project_index_slug_id_uidx" ON "project_index" USING btree ("slug","id");--> statement-breakpoint
ALTER TABLE "project_invite_grant" ADD CONSTRAINT "project_invite_grant_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_invite_grant" ADD CONSTRAINT "project_invite_grant_project_slug_id_fkey" FOREIGN KEY ("project_slug","project_id") REFERENCES "public"."project_index"("slug","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_invite_grant_project_idx" ON "project_invite_grant" USING btree ("project_slug");--> statement-breakpoint
